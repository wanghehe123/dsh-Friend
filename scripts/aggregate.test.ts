import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts/aggregate.mjs')
const fixtures: string[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function run(root: string, ...args: string[]) {
  try {
    const result = await execFileAsync(process.execPath, [SCRIPT, '--root', root, ...args], {
      cwd: ROOT,
    })
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    }
  }
}

async function writeTree(root: string, files: Record<string, string>) {
  for (const [rel, contents] of Object.entries(files)) {
    const path = join(root, rel)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents, 'utf8')
  }
}

async function createWorkspace(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-friend-aggregate-'))
  fixtures.push(root)
  await writeTree(root, files)
  return root
}

function featureManifest(name: string) {
  return `${JSON.stringify({ name, version: '0.1.0' }, null, 2)}\n`
}

function fixtureFiles(options?: { includeOrphan?: boolean }) {
  const files: Record<string, string> = {
    'packages/dsh-friend-all/aggregate.yml': [
      'patchFrom:',
      "  - '@wishp3/dsh-friend-alpha'",
      "  - '@wishp3/dsh-friend-beta'",
      'deps:',
      "  - '@wishp3/dsh-friend-beta'",
      "  - '@wishp3/dsh-friend-alpha'",
      '',
    ].join('\n'),
    'packages/dsh-friend-all/package.json': `${JSON.stringify({
      name: '@wishp3/dsh-friend-all',
      version: '0.1.0',
      dependencies: {
        leftover: '^1.0.0',
      },
    }, null, 2)}\n`,
    'packages/dsh-friend-all/cordis.patch.yml': '# stale\n',
    'packages/dsh-friend-alpha/package.json': featureManifest('@wishp3/dsh-friend-alpha'),
    'packages/dsh-friend-beta/package.json': featureManifest('@wishp3/dsh-friend-beta'),
  }

  if (options?.includeOrphan === true) {
    files['packages/dsh-friend-orphan/package.json'] = featureManifest('@wishp3/dsh-friend-orphan')
  }

  return files
}

describe('aggregate bundle guard', () => {
  it('keeps the checked-in aggregate patch and dependency list in sync', async () => {
    const result = await run(ROOT, '--check')

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('aggregate is up to date')
  })

  it('generates a fixture bundle from aggregate.yml', async () => {
    const root = await createWorkspace(fixtureFiles())
    const result = await run(root)

    expect(result.code).toBe(0)

    const patch = await readFile(join(root, 'packages/dsh-friend-all/cordis.patch.yml'), 'utf8')
    const manifest = JSON.parse(await readFile(join(root, 'packages/dsh-friend-all/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }

    expect(patch).toMatchSnapshot('cordis.patch.yml')
    expect(manifest.dependencies).toMatchSnapshot('dependencies')
  })

  it('exits 1 when a generated file has drifted', async () => {
    const root = await createWorkspace(fixtureFiles())
    expect((await run(root)).code).toBe(0)

    const patchPath = join(root, 'packages/dsh-friend-all/cordis.patch.yml')
    const patch = await readFile(patchPath, 'utf8')
    await writeFile(patchPath, patch.replace('dsh-friend-alpha', 'dsh-friend-stale'), 'utf8')

    const result = await run(root, '--check')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('aggregate drift')
    expect(result.stderr).toContain('packages/dsh-friend-all/cordis.patch.yml')
    expect(result.stderr).toContain('dsh-friend-stale')
  })

  it('reports a feature package missing from aggregate.yml', async () => {
    const root = await createWorkspace(fixtureFiles({ includeOrphan: true }))
    const result = await run(root, '--check')

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('unregistered feature package')
    expect(result.stderr).toContain('@wishp3/dsh-friend-orphan')
  })
})
