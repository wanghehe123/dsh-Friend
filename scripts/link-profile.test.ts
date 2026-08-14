import { lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  BUILD_HINT,
  isManagedSymlink,
  parseArgs,
  runLinkProfile,
  unlinkIfSymlink,
} from './link-profile.mjs'

const fixtures: string[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTemp(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  fixtures.push(dir)
  return dir
}

async function writePackage(repoRoot: string, dirName: string, name: string, withLib: boolean) {
  const dir = join(repoRoot, 'packages', dirName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), `${JSON.stringify({ name }, null, 2)}\n`)
  if (withLib) {
    await mkdir(join(dir, 'lib'), { recursive: true })
    await writeFile(join(dir, 'lib', 'index.js'), 'export {}\n')
  }
  return dir
}

async function makeWorkspace() {
  const repoRoot = await makeTemp('dsh-friend-link-repo-')
  const profileRoot = await makeTemp('dsh-friend-link-profile-')
  const shared = await writePackage(repoRoot, 'dsh-friend-shared', '@wish233/dsh-friend-shared', true)
  const persona = await writePackage(repoRoot, 'dsh-friend-persona', '@wish233/dsh-friend-persona', true)
  return { repoRoot, profileRoot, shared, persona }
}

describe('parseArgs', () => {
  it('defaults to the web profile', () => {
    expect(parseArgs([])).toEqual({
      help: false,
      profile: 'web',
      dryRun: false,
      unlink: false,
    })
  })

  it('accepts --profile, --dry-run, and --unlink', () => {
    expect(parseArgs(['--profile', 'tui', '--dry-run', '--unlink'])).toEqual({
      help: false,
      profile: 'tui',
      dryRun: true,
      unlink: true,
    })
  })

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['--explode'])).toThrow(/Unknown argument/)
  })
})

describe('runLinkProfile', () => {
  it('dry-run prints would link and writes nothing', async () => {
    const { repoRoot, profileRoot, shared } = await makeWorkspace()
    const result = await runLinkProfile({ repoRoot, profileRoot, dryRun: true })

    expect(result.ok).toBe(true)
    expect(result.lines.some((line) => line.startsWith('would link') && line.includes('@wish233/dsh-friend-shared'))).toBe(true)
    expect(result.lines.some((line) => line.startsWith('would link') && line.includes('@wish233/dsh-friend-persona'))).toBe(true)
    await expect(lstat(join(profileRoot, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(shared)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('creates symlinks that point at the package directories', async () => {
    const { repoRoot, profileRoot, shared, persona } = await makeWorkspace()
    const result = await runLinkProfile({ repoRoot, profileRoot })

    expect(result.ok).toBe(true)
    expect(result.lines.every((line) => line.startsWith('linked'))).toBe(true)

    const sharedLink = join(profileRoot, 'node_modules/@wish233/dsh-friend-shared')
    const personaLink = join(profileRoot, 'node_modules/@wish233/dsh-friend-persona')
    await expect(lstat(sharedLink)).resolves.toMatchObject({ isSymbolicLink: expect.any(Function) })
    expect((await lstat(sharedLink)).isSymbolicLink()).toBe(true)
    expect((await lstat(personaLink)).isSymbolicLink()).toBe(true)
    expect(await realpath(sharedLink)).toBe(await realpath(shared))
    expect(await realpath(personaLink)).toBe(await realpath(persona))
  })

  it('skips an already-correct link and --unlink removes only our symlinks', async () => {
    const { repoRoot, profileRoot, shared } = await makeWorkspace()
    await runLinkProfile({ repoRoot, profileRoot })

    const second = await runLinkProfile({ repoRoot, profileRoot })
    expect(second.ok).toBe(true)
    expect(second.lines.every((line) => line.startsWith('skipped') && line.includes('already linked'))).toBe(true)

    const unlinked = await runLinkProfile({ repoRoot, profileRoot, unlink: true })
    expect(unlinked.ok).toBe(true)
    expect(unlinked.lines.every((line) => line.startsWith('unlinked'))).toBe(true)

    const sharedLink = join(profileRoot, 'node_modules/@wish233/dsh-friend-shared')
    await expect(lstat(sharedLink)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(shared)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
    await expect(lstat(join(shared, 'lib/index.js'))).resolves.toBeTruthy()
  })

  it('refuses a real directory, does not delete it, and writes no other links', async () => {
    const { repoRoot, profileRoot } = await makeWorkspace()
    const realDir = join(profileRoot, 'node_modules/@wish233/dsh-friend-shared')
    await mkdir(realDir, { recursive: true })
    const sentinel = join(realDir, 'keep-me.txt')
    await writeFile(sentinel, 'user data\n')

    const result = await runLinkProfile({ repoRoot, profileRoot })

    expect(result.ok).toBe(false)
    expect(result.errors.some((line) => line.includes('Refusing to overwrite real directory'))).toBe(true)
    expect((await lstat(sentinel)).isSymbolicLink()).toBe(false)
    expect((await lstat(realDir)).isDirectory()).toBe(true)
    expect((await lstat(sentinel)).isFile()).toBe(true)
    await expect(lstat(join(profileRoot, 'node_modules/@wish233/dsh-friend-persona'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('refuses to --unlink a real directory', async () => {
    const { repoRoot, profileRoot } = await makeWorkspace()
    const realDir = join(profileRoot, 'node_modules/@wish233/dsh-friend-shared')
    await mkdir(realDir, { recursive: true })
    const sentinel = join(realDir, 'keep-me.txt')
    await writeFile(sentinel, 'user data\n')

    const result = await runLinkProfile({ repoRoot, profileRoot, unlink: true })

    expect(result.ok).toBe(false)
    expect(result.errors.some((line) => /Refusing to delete real directory/.test(line))).toBe(true)
    expect((await lstat(sentinel)).isFile()).toBe(true)
  })

  it('refuses a live foreign symlink (pnpm store style) and leaves it in place', async () => {
    const { repoRoot, profileRoot } = await makeWorkspace()
    const foreign = await makeTemp('dsh-friend-foreign-pkg-')
    await writeFile(join(foreign, 'index.js'), 'export const foreign = true\n')
    const target = join(profileRoot, 'node_modules/@wish233/dsh-friend-shared')
    await mkdir(dirname(target), { recursive: true })
    await symlink(foreign, target)

    const result = await runLinkProfile({ repoRoot, profileRoot })

    expect(result.ok).toBe(false)
    expect(result.errors.some((line) => line.includes('foreign symlink'))).toBe(true)
    expect(await realpath(target)).toBe(await realpath(foreign))
  })

  it('hints at pnpm -r build when lib/ is missing and does not link', async () => {
    const repoRoot = await makeTemp('dsh-friend-link-nolib-repo-')
    const profileRoot = await makeTemp('dsh-friend-link-nolib-profile-')
    await writePackage(repoRoot, 'dsh-friend-shared', '@wish233/dsh-friend-shared', false)

    const result = await runLinkProfile({ repoRoot, profileRoot })

    expect(result.ok).toBe(false)
    expect(result.lines.some((line) => line.startsWith('skipped') && line.includes('missing lib/'))).toBe(true)
    expect(result.errors.some((line) => line.includes(BUILD_HINT))).toBe(true)
    await expect(lstat(join(profileRoot, 'node_modules/@wish233/dsh-friend-shared'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('fails loud when the profile directory does not exist', async () => {
    const { repoRoot } = await makeWorkspace()
    const missing = join(tmpdir(), 'dsh-friend-no-such-profile', String(Date.now()))
    const result = await runLinkProfile({ repoRoot, profileRoot: missing })

    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('Profile not found')
    expect(result.errors.some((line) => line.includes('dsh web'))).toBe(true)
  })

  it('dry-run --unlink does not remove an existing managed symlink', async () => {
    const { repoRoot, profileRoot } = await makeWorkspace()
    await runLinkProfile({ repoRoot, profileRoot })
    const target = join(profileRoot, 'node_modules/@wish233/dsh-friend-shared')
    expect((await lstat(target)).isSymbolicLink()).toBe(true)

    const result = await runLinkProfile({ repoRoot, profileRoot, dryRun: true, unlink: true })
    expect(result.ok).toBe(true)
    expect(result.lines.every((line) => line.startsWith('would unlink'))).toBe(true)
    expect((await lstat(target)).isSymbolicLink()).toBe(true)
  })
})

describe('unlinkIfSymlink', () => {
  it('throws instead of deleting a real directory', async () => {
    const dir = await makeTemp('dsh-friend-unlink-dir-')
    const sentinel = join(dir, 'keep-me.txt')
    await writeFile(sentinel, 'nope\n')

    await expect(unlinkIfSymlink(dir)).rejects.toThrow(/Refusing to delete real directory/)
    expect((await lstat(sentinel)).isFile()).toBe(true)
  })
})

describe('isManagedSymlink', () => {
  it('recognizes a link into this repo packages/ tree', async () => {
    const { repoRoot, profileRoot, shared } = await makeWorkspace()
    const target = join(profileRoot, 'node_modules/@wish233/dsh-friend-shared')
    await mkdir(dirname(target), { recursive: true })
    await symlink(shared, target)

    expect(await isManagedSymlink(target, shared, repoRoot)).toBe(true)
  })
})
