import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import {
  PACKAGE_NAME,
  checkPixiLive2d,
  formatFailure,
  inspectPixiPackage,
  parseArgs,
} from './check-pixi-live2d.mjs'

const execFileAsync = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts/check-pixi-live2d.mjs')
const fixtures: string[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTemp(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  fixtures.push(dir)
  return dir
}

async function writeTree(root: string, files: Record<string, string>) {
  for (const [rel, contents] of Object.entries(files)) {
    const path = join(root, rel)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents, 'utf8')
  }
}

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

function goodManifest() {
  return `${JSON.stringify({ name: PACKAGE_NAME, version: '0.4.0' }, null, 2)}\n`
}

describe('parseArgs', () => {
  it('accepts --root and --package', () => {
    const parsed = parseArgs(['--root', '/tmp/ws', '--package', '/tmp/pixi'])
    expect(parsed.help).toBe(false)
    expect(parsed.root).toMatch(/\/tmp\/ws$/)
    expect(parsed.packageDir).toMatch(/\/tmp\/pixi$/)
  })

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['--explode'])).toThrow(/unknown argument/)
  })
})

describe('inspectPixiPackage', () => {
  it('accepts a package.json plus non-empty cubism4 and index dist files', async () => {
    const dir = await makeTemp('dsh-friend-pixi-ok-')
    await writeTree(dir, {
      'package.json': goodManifest(),
      'dist/index.js': 'export {}\n',
      'dist/cubism4.es.js': 'export const Live2DModel = {}\n',
    })
    const result = await inspectPixiPackage(dir)
    expect(result).toEqual({ ok: true, packageDir: dir, missing: [] })
  })

  it('fails when package.json or dist is missing', async () => {
    const empty = await makeTemp('dsh-friend-pixi-empty-')
    const emptyResult = await inspectPixiPackage(empty)
    expect(emptyResult.ok).toBe(false)
    expect(emptyResult.missing).toContain('package.json')
    expect(emptyResult.missing).toContain('dist/')

    const noDist = await makeTemp('dsh-friend-pixi-nodist-')
    await writeTree(noDist, { 'package.json': goodManifest() })
    const noDistResult = await inspectPixiPackage(noDist)
    expect(noDistResult.ok).toBe(false)
    expect(noDistResult.missing).toContain('dist/')
    expect(noDistResult.missing.some((item) => item.includes('cubism4'))).toBe(true)
  })

  it('fails when dist files exist but are empty', async () => {
    const dir = await makeTemp('dsh-friend-pixi-emptyfiles-')
    await writeTree(dir, {
      'package.json': goodManifest(),
      'dist/index.js': '',
      'dist/cubism4.js': '',
    })
    const result = await inspectPixiPackage(dir)
    expect(result.ok).toBe(false)
    expect(result.missing.some((item) => item.includes('index.js'))).toBe(true)
    expect(result.missing.some((item) => item.includes('cubism4'))).toBe(true)
  })
})

describe('checkPixiLive2d CLI', () => {
  it('exits 0 for a complete fixture and 1 for an empty shell', async () => {
    const good = await makeTemp('dsh-friend-pixi-cli-ok-')
    await writeTree(good, {
      'package.json': goodManifest(),
      'dist/index.es.js': 'export {}\n',
      'dist/cubism4.js': 'export {}\n',
    })
    const ok = await run(['--package', good])
    expect(ok.code).toBe(0)
    expect(ok.stdout).toContain(`${PACKAGE_NAME}: ok`)

    const bad = await makeTemp('dsh-friend-pixi-cli-bad-')
    const fail = await run(['--package', bad])
    expect(fail.code).toBe(1)
    expect(fail.stderr).toContain('empty shell')
    expect(fail.stderr).toContain('chmod -R a+X')
    expect(fail.stderr).toContain('Do not vendor')
    expect(fail.stderr).toContain('docs/dev-loop.md')
  })

  it('exits 0 against this workspace install', async () => {
    const result = await checkPixiLive2d({ root: ROOT })
    expect(result.ok, result.message).toBe(true)
    const cli = await run([])
    expect(cli.code).toBe(0)
  })
})

describe('formatFailure', () => {
  it('names the empty-shell cause and the repair path', () => {
    const text = formatFailure('/tmp/pixi', ['package.json', 'dist/'])
    expect(text).toContain('empty shell')
    expect(text).toContain('execute bit')
    expect(text).toContain('lib/pet.iife.js')
    expect(text).toContain('node_modules/.pnpm/pixi-live2d-display@0.4.0')
  })
})
