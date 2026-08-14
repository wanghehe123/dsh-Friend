import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import {
  exitCodeFor,
  isForbiddenPublishPath,
  parseTagVersion,
  scan,
} from './release-scan.mjs'

const execFileAsync = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts/release-scan.mjs')
const fixtures: string[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function run(args: string[]) {
  try {
    const result = await execFileAsync(process.execPath, [SCRIPT, ...args], { cwd: ROOT })
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

async function createPackage(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-friend-release-scan-'))
  fixtures.push(root)
  await writeTree(root, files)
  return root
}

function manifest(overrides: Record<string, unknown> = {}) {
  return `${JSON.stringify(
    {
      name: '@wishp3/dsh-friend-scan-fixture',
      version: '0.1.0',
      files: ['lib'],
      ...overrides,
    },
    null,
    2,
  )}\n`
}

const PET_IIFE = [
  '/* pet bundle */',
  'window.Live2DCubismCore = window.Live2DCubismCore;',
  'console.log("live2dcubismcore global is provided by the host page");',
  '',
].join('\n')

describe('forbidden path predicate (filename only)', () => {
  it('rejects Cubism Core and model files, not JS that mentions the global', () => {
    expect(isForbiddenPublishPath('lib/live2dcubismcore.min.js')).toBe(true)
    expect(isForbiddenPublishPath('vendor/Live2DCubismCore.min.js')).toBe(true)
    expect(isForbiddenPublishPath('lib/live2dcubismcore.js')).toBe(true)
    expect(isForbiddenPublishPath('models/Hiyori.moc3')).toBe(true)
    expect(isForbiddenPublishPath('models/Hiyori.model3.json')).toBe(true)
    expect(isForbiddenPublishPath('old/model.moc')).toBe(true)

    expect(isForbiddenPublishPath('lib/pet.iife.js')).toBe(false)
    expect(isForbiddenPublishPath('lib/index.js')).toBe(false)
    expect(isForbiddenPublishPath('THIRD-PARTY-NOTICES.md')).toBe(false)
    expect(isForbiddenPublishPath('vendor-integrity.json')).toBe(false)
    expect(isForbiddenPublishPath('src/live2d/asset-layout.ts')).toBe(false)
  })

  it('parses release tags', () => {
    expect(parseTagVersion('v0.1.0')).toBe('0.1.0')
    expect(parseTagVersion('npm-v0.1.0-rc.1')).toBe('0.1.0-rc.1')
    expect(parseTagVersion('refs/tags/v1.2.3')).toBe('1.2.3')
    expect(parseTagVersion('shell-v0.1.0')).toBe('0.1.0')
  })
})

// Each case shells out to `npm pack` twice (once through `scan()`, once through
// the CLI). npm's own startup dominates, so the default 5s budget is not enough
// on slower disks.
describe('pack file-name scan', { timeout: 30_000 }, () => {
  it('allows a pet IIFE that references Live2DCubismCore by name', async () => {
    const dir = await createPackage({
      'package.json': manifest(),
      'lib/pet.iife.js': PET_IIFE,
      'README.md': 'mentions live2dcubismcore.min.js as a runtime download, not a packed file\n',
    })
    expect(PET_IIFE.toLowerCase()).toContain('live2dcubismcore')

    const result = await scan({
      root: dir,
      pack: true,
      checkVersions: false,
      requirePublishable: false,
      packages: [dir],
    })
    expect(result.hits).toEqual([])
    expect(result.listings[0]?.paths.some((path) => path.endsWith('lib/pet.iife.js'))).toBe(true)
    expect(exitCodeFor(result)).toBe(0)

    const cli = await run(['--package', dir, '--pack'])
    expect(cli.code).toBe(0)
    expect(cli.stdout).toContain('release-scan: ok')
  })

  it('fails when the tarball would include a .moc3', async () => {
    const dir = await createPackage({
      'package.json': manifest(),
      'lib/pet.iife.js': PET_IIFE,
      'lib/Hiyori.moc3': 'not-a-real-model',
    })
    const result = await scan({
      root: dir,
      pack: true,
      checkVersions: false,
      requirePublishable: false,
      packages: [dir],
    })
    expect(result.hits.map((hit) => hit.path)).toContain('lib/Hiyori.moc3')
    expect(exitCodeFor(result)).toBe(1)

    const cli = await run(['--package', dir, '--pack'])
    expect(cli.code).toBe(1)
    expect(cli.stderr).toContain('Hiyori.moc3')
  })

  it('fails for .model3.json and live2dcubismcore.min.js file names', async () => {
    const modelDir = await createPackage({
      'package.json': manifest({ name: '@wishp3/scan-model' }),
      'lib/Hiyori.model3.json': '{}',
    })
    const coreDir = await createPackage({
      'package.json': manifest({ name: '@wishp3/scan-core' }),
      'lib/live2dcubismcore.min.js': 'proprietary',
    })

    const model = await scan({
      root: modelDir,
      pack: true,
      checkVersions: false,
      requirePublishable: false,
      packages: [modelDir],
    })
    const core = await scan({
      root: coreDir,
      pack: true,
      checkVersions: false,
      requirePublishable: false,
      packages: [coreDir],
    })
    expect(model.hits.some((hit) => hit.path.endsWith('Hiyori.model3.json'))).toBe(true)
    expect(core.hits.some((hit) => hit.path.endsWith('live2dcubismcore.min.js'))).toBe(true)
  })

  it('does not treat an unpackaged moc3 next to the package as packed', async () => {
    const dir = await createPackage({
      'package.json': manifest(),
      'lib/index.js': 'export {}\n',
      'scratch/Hiyori.moc3': 'left-over local file',
    })
    const result = await scan({
      root: dir,
      pack: true,
      checkVersions: false,
      requirePublishable: false,
      packages: [dir],
    })
    expect(result.hits).toEqual([])
    expect(result.listings[0]?.paths.some((path) => path.includes('Hiyori.moc3'))).toBe(false)
  })
})

describe('version and publishable gates', () => {
  it('flags diverging versions and a tag mismatch', async () => {
    const a = await createPackage({
      'package.json': manifest({ name: '@wishp3/a', version: '0.1.0' }),
      'lib/index.js': 'export {}\n',
    })
    const b = await createPackage({
      'package.json': manifest({ name: '@wishp3/b', version: '0.2.0' }),
      'lib/index.js': 'export {}\n',
    })
    const diverged = await scan({
      root: a,
      pack: false,
      checkVersions: true,
      requirePublishable: false,
      packages: [a, b],
    })
    expect(diverged.versionErrors.length).toBeGreaterThan(0)
    expect(exitCodeFor(diverged)).toBe(1)

    const tagged = await scan({
      root: a,
      pack: false,
      checkVersions: true,
      requirePublishable: false,
      tag: 'v9.9.9',
      packages: [a],
    })
    expect(tagged.versionErrors.some((line) => line.includes('9.9.9'))).toBe(true)
  })

  it('workspace packages are publishable at the same version', async () => {
    const result = await scan({
      root: ROOT,
      pack: false,
      checkVersions: true,
      requirePublishable: true,
      packages: [],
    })
    expect(result.publishableErrors).toEqual([])
    expect(result.versionErrors).toEqual([])
    expect(new Set(result.versions.map((item) => item.version))).toEqual(new Set(['0.1.0']))
    expect(result.versions).toHaveLength(11)
    expect(exitCodeFor(result)).toBe(0)
  })

  it('require-publishable accepts a public package with a license', async () => {
    const dir = await createPackage({
      'package.json': manifest({ license: 'MIT', publishConfig: { access: 'public' } }),
      'lib/index.js': 'export {}\n',
    })
    const result = await scan({
      root: dir,
      pack: false,
      checkVersions: false,
      requirePublishable: true,
      packages: [dir],
    })
    expect(result.publishableErrors).toEqual([])
    expect(exitCodeFor(result)).toBe(0)
  })

  it('require-publishable fails on private packages without license', async () => {
    const dir = await createPackage({
      'package.json': manifest({ private: true }),
      'lib/index.js': 'export {}\n',
    })
    const result = await scan({
      root: dir,
      pack: false,
      checkVersions: false,
      requirePublishable: true,
      packages: [dir],
    })
    expect(result.publishableErrors.some((line) => line.includes('private'))).toBe(true)
    expect(result.publishableErrors.some((line) => line.includes('license'))).toBe(true)
    expect(exitCodeFor(result)).toBe(1)
  })
})
