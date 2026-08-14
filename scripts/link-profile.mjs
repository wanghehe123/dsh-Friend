#!/usr/bin/env node
/**
 * Link this repo's `@wish233/dsh-friend-*` packages into a dsh profile's
 * `node_modules` so `dsh web` loads the local `lib/` build.
 *
 *   export CI=true    # required: pnpm without a TTY aborts with
 *                     # ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
 *   pnpm -r build
 *   node scripts/link-profile.mjs [--profile web] [--dry-run] [--unlink]
 *
 * Target:
 *   $DSH_HOME/profiles/<profile>/node_modules/@wish233/<pkg>
 *     → <repo>/packages/<pkg>
 *
 * Safety: this script never `rm -rf`s anything. The only destructive call is
 * `fs.unlink` on a path that `lstat` has just confirmed is a symbolic link
 * *we* created (it already points at this repo's `packages/`, or is a dangling
 * leftover at our managed path). A real directory or a live foreign symlink
 * (for example a pnpm store link from `dsh plugin add`) is a hard error.
 */
import { lstat, mkdir, readFile, readdir, readlink, symlink, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const SCOPE = '@wish233'
export const DEFAULT_PROFILE = 'web'
export const BUILD_HINT = 'export CI=true && pnpm -r build'
export const PROFILE_PATCH_NAME = 'cordis.patch.yml'
export const FRIEND_PATCH_MARKER = "id: dsh-friend-shared"

export function usage() {
  return `Usage: node scripts/link-profile.mjs [--profile <name>] [--dry-run] [--unlink]

Link @wish233/dsh-friend-* package directories into a dsh profile so \`dsh web\`
loads this checkout's lib/ builds.

  --profile <name>   Profile under $DSH_HOME/profiles (default: web)
  --dry-run          Print linked / skipped / would link; write nothing
  --unlink           Remove symlinks this script created (never real directories)

pnpm 11 on this machine aborts without a TTY unless CI=true
(ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). Set it before install/build.`
}

export function parseArgs(argv) {
  let profile = DEFAULT_PROFILE
  let dryRun = false
  let unlinkLinks = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--unlink') {
      unlinkLinks = true
      continue
    }
    if (arg === '--profile') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--profile requires a name')
      }
      profile = value
      index += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      return { help: true, profile, dryRun, unlink: unlinkLinks }
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (profile === '' || profile.includes('/') || profile.includes('\\') || profile === '.' || profile === '..' || profile === 'node_modules') {
    throw new Error(`invalid profile name ${JSON.stringify(profile)}`)
  }

  return { help: false, profile, dryRun, unlink: unlinkLinks }
}

export function resolveDshHome(env = process.env) {
  const override = env.DSH_HOME
  if (typeof override === 'string' && override.length > 0) {
    return resolve(override)
  }
  return join(homedir(), '.dsh')
}

export function resolveProfileRoot(profile, env = process.env) {
  return join(resolveDshHome(env), 'profiles', profile)
}

export function linkPathFor(profileRoot, packageName) {
  if (!packageName.startsWith(`${SCOPE}/`)) {
    throw new Error(`refusing to link unmanaged package ${packageName}`)
  }
  return join(profileRoot, 'node_modules', SCOPE, packageName.slice(SCOPE.length + 1))
}

async function pathKind(path) {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) {
      return 'symlink'
    }
    if (stat.isDirectory()) {
      return 'directory'
    }
    return 'file'
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return 'missing'
    }
    throw error
  }
}

function within(root, candidate) {
  const path = resolve(candidate)
  const traversal = relative(root, path)
  return traversal === '' || (!isAbsolute(traversal) && !traversal.startsWith('..') && traversal !== '..')
}

export function resolveSymlinkTarget(linkPath, rawTarget) {
  return isAbsolute(rawTarget) ? resolve(rawTarget) : resolve(dirname(linkPath), rawTarget)
}

/**
 * A symlink is "ours" only when it already points at this checkout's package
 * dir, or at some path under repo/packages, or when it is dangling at the
 * exact managed location (leftover from a moved checkout). Live links into
 * pnpm's store or any other tree are foreign and must not be replaced.
 */
export async function isManagedSymlink(linkPath, packageDir, repoRoot) {
  const kind = await pathKind(linkPath)
  if (kind !== 'symlink') {
    return false
  }
  const raw = await readlink(linkPath)
  const current = resolveSymlinkTarget(linkPath, raw)
  if (current === resolve(packageDir)) {
    return true
  }
  if (within(join(repoRoot, 'packages'), current)) {
    return true
  }
  const targetKind = await pathKind(current)
  return targetKind === 'missing'
}

export async function discoverPackages(repoRoot) {
  const packagesDir = join(repoRoot, 'packages')
  const kind = await pathKind(packagesDir)
  if (kind !== 'directory') {
    throw new Error(`packages/ not found under ${repoRoot}`)
  }

  const names = await readdir(packagesDir)
  const packages = []

  for (const dirName of names.sort()) {
    const dir = join(packagesDir, dirName)
    const dirKind = await pathKind(dir)
    if (dirKind !== 'directory') {
      continue
    }
    const manifestPath = join(dir, 'package.json')
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (typeof manifest.name !== 'string' || !manifest.name.startsWith(`${SCOPE}/dsh-friend-`)) {
        continue
      }
      packages.push({
        dir,
        dirName,
        name: manifest.name,
        hasLib: (await pathKind(join(dir, 'lib'))) === 'directory',
      })
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        continue
      }
      throw error
    }
  }

  if (packages.length === 0) {
    throw new Error(`no ${SCOPE}/dsh-friend-* packages found under ${packagesDir}`)
  }

  return packages
}

function formatLine(status, name, detail) {
  return `${status.padEnd(11)} ${name}  ${detail}`
}

/**
 * Plan and optionally apply link / unlink actions.
 *
 * @param {{
 *   repoRoot: string,
 *   profileRoot: string,
 *   dryRun?: boolean,
 *   unlink?: boolean,
 * }} options
 */
export async function runLinkProfile(options) {
  const repoRoot = resolve(options.repoRoot)
  const profileRoot = resolve(options.profileRoot)
  const dryRun = options.dryRun === true
  const unlinkMode = options.unlink === true
  const lines = []
  const errors = []

  const profileKind = await pathKind(profileRoot)
  if (profileKind === 'missing') {
    errors.push(`Profile not found: ${profileRoot}`)
    errors.push('Run `dsh web` once to create the profile directory, then re-run this script.')
    errors.push('(web / headless auto-initialize on first boot; other names need `dsh plugin --profile <name> …`.)')
    return { ok: false, lines, errors }
  }
  if (profileKind !== 'directory') {
    errors.push(`Profile path exists but is not a directory: ${profileRoot}`)
    return { ok: false, lines, errors }
  }

  const packages = await discoverPackages(repoRoot)
  const planned = []
  let blocking = false

  for (const pkg of packages) {
    const target = linkPathFor(profileRoot, pkg.name)
    const kind = await pathKind(target)

    if (unlinkMode) {
      if (kind === 'missing') {
        planned.push({ pkg, target, status: dryRun ? 'skipped' : 'skipped', detail: '(not linked)', apply: 'none' })
        continue
      }
      if (kind !== 'symlink') {
        blocking = true
        planned.push({
          pkg,
          target,
          status: 'error',
          detail: `refusing to delete real ${kind}: ${target}`,
          apply: 'none',
        })
        errors.push(`Refusing to delete real ${kind} (not a symlink): ${target}`)
        continue
      }
      if (!(await isManagedSymlink(target, pkg.dir, repoRoot))) {
        blocking = true
        const raw = await readlink(target)
        planned.push({
          pkg,
          target,
          status: 'error',
          detail: `refusing to unlink foreign symlink → ${raw}`,
          apply: 'none',
        })
        errors.push(`Refusing to unlink foreign symlink ${target} → ${raw}`)
        continue
      }
      planned.push({
        pkg,
        target,
        status: dryRun ? 'would unlink' : 'unlinked',
        detail: target,
        apply: dryRun ? 'none' : 'unlink',
      })
      continue
    }

    if (!pkg.hasLib) {
      blocking = true
      planned.push({
        pkg,
        target,
        status: 'skipped',
        detail: `(missing lib/; ${BUILD_HINT})`,
        apply: 'none',
      })
      errors.push(`${pkg.name} has no lib/ — ${BUILD_HINT} first`)
      continue
    }

    if (kind === 'missing') {
      planned.push({
        pkg,
        target,
        status: dryRun ? 'would link' : 'linked',
        detail: `→ ${pkg.dir}`,
        apply: dryRun ? 'none' : 'link',
      })
      continue
    }

    if (kind !== 'symlink') {
      blocking = true
      planned.push({
        pkg,
        target,
        status: 'error',
        detail: `refusing to overwrite real ${kind}: ${target}`,
        apply: 'none',
      })
      errors.push(`Refusing to overwrite real ${kind} (not a symlink): ${target}`)
      continue
    }

    if (await isManagedSymlink(target, pkg.dir, repoRoot)) {
      const raw = await readlink(target)
      const current = resolveSymlinkTarget(target, raw)
      if (current === resolve(pkg.dir)) {
        planned.push({
          pkg,
          target,
          status: 'skipped',
          detail: `(already linked → ${pkg.dir})`,
          apply: 'none',
        })
        continue
      }
      planned.push({
        pkg,
        target,
        status: dryRun ? 'would link' : 'linked',
        detail: `→ ${pkg.dir}`,
        apply: dryRun ? 'none' : 'relink',
      })
      continue
    }

    const raw = await readlink(target)
    blocking = true
    planned.push({
      pkg,
      target,
      status: 'error',
      detail: `refusing to replace foreign symlink → ${raw}`,
      apply: 'none',
    })
    errors.push(`Refusing to replace foreign symlink ${target} → ${raw}`)
  }

  for (const item of planned) {
    lines.push(formatLine(item.status, item.pkg.name, item.detail))
  }

  if (blocking) {
    return { ok: false, lines, errors }
  }

  if (!dryRun) {
    for (const item of planned) {
      if (item.apply === 'none') {
        continue
      }
      // Re-check immediately before any mutation. Only unlink after lstat
      // says "symlink"; never fs.rm / rm -rf / recursive delete.
      if (item.apply === 'unlink' || item.apply === 'relink') {
        await unlinkIfSymlink(item.target)
      }
      if (item.apply === 'link' || item.apply === 'relink') {
        await mkdir(dirname(item.target), { recursive: true })
        await symlink(resolve(item.pkg.dir), item.target, 'junction')
      }
    }
  }

  const patch = await planFriendPatch({
    profileRoot,
    packageNames: packages.map((pkg) => pkg.name),
    dryRun,
    unlink: unlinkMode,
  })
  lines.push(formatLine(patch.status, PROFILE_PATCH_NAME, patch.detail))
  if (patch.error !== undefined) {
    errors.push(patch.error)
    return { ok: false, lines, errors }
  }
  if (!dryRun && patch.apply === 'write' && patch.contents !== undefined) {
    await writeFile(join(profileRoot, PROFILE_PATCH_NAME), patch.contents, 'utf8')
  }

  return { ok: true, lines, errors }
}

export function renderProfileFriendPatch(packageNames) {
  const rows = packageNames.map((name) => {
    const id = name.replace(/^@[^/]+\//, '')
    return `    - id: ${id}\n      name: '${name}'`
  })
  return `# dsh-Friend local install. Written by scripts/link-profile.mjs.\n# Ordinary \`dsh web\` reads this file; do not replace it with [].\n- insert:\n${rows.join('\n')}\n`
}

export function isDefaultEmptyPatch(text) {
  const stripped = text.replace(/^\s*#.*$/gm, '').trim()
  return stripped === '' || stripped === '[]'
}

export async function planFriendPatch(options) {
  const patchPath = join(options.profileRoot, PROFILE_PATCH_NAME)
  const contents = renderProfileFriendPatch(options.packageNames)
  const kind = await pathKind(patchPath)

  if (options.unlink === true) {
    if (kind === 'missing') {
      return { status: options.dryRun ? 'skipped' : 'skipped', detail: '(no patch)', apply: 'none' }
    }
    const current = await readFile(patchPath, 'utf8')
    if (!current.includes(FRIEND_PATCH_MARKER)) {
      return { status: 'skipped', detail: '(foreign patch left in place)', apply: 'none' }
    }
    if (options.dryRun) {
      return { status: 'would unlink', detail: patchPath, apply: 'none' }
    }
    return {
      status: 'unlinked',
      detail: 'restored empty patch',
      apply: 'write',
      contents: '# Your patch layer for this dsh profile.\n[]\n',
    }
  }

  if (kind === 'missing' || (kind === 'file' && isDefaultEmptyPatch(await readFile(patchPath, 'utf8')))) {
    return {
      status: options.dryRun ? 'would link' : 'linked',
      detail: 'install friend plugin list',
      apply: options.dryRun ? 'none' : 'write',
      contents,
    }
  }

  if (kind !== 'file') {
    return {
      status: 'error',
      detail: `refusing to overwrite ${kind}`,
      apply: 'none',
      error: `Refusing to overwrite ${kind}: ${patchPath}`,
    }
  }

  const current = await readFile(patchPath, 'utf8')
  if (current.includes(FRIEND_PATCH_MARKER)) {
    if (current === contents) {
      return { status: 'skipped', detail: '(already installed)', apply: 'none' }
    }
    return {
      status: options.dryRun ? 'would link' : 'linked',
      detail: 'refresh friend plugin list',
      apply: options.dryRun ? 'none' : 'write',
      contents,
    }
  }

  return {
    status: 'error',
    detail: 'refusing to replace a custom cordis.patch.yml',
    apply: 'none',
    error: `Refusing to replace custom ${patchPath}. Add the dsh-friend insert list yourself, or move the file aside.`,
  }
}

/**
 * Remove a path only when it is still a symlink. Throws rather than touching
 * a real directory or file (TOCTOU: a second lstat immediately before unlink).
 */
export async function unlinkIfSymlink(path) {
  const kind = await pathKind(path)
  if (kind === 'missing') {
    return
  }
  if (kind !== 'symlink') {
    throw new Error(`Refusing to delete real ${kind}: ${path}`)
  }
  await unlink(path)
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      console.log(usage())
      return
    }
    const result = await runLinkProfile({
      repoRoot: DEFAULT_ROOT,
      profileRoot: resolveProfileRoot(options.profile),
      dryRun: options.dryRun,
      unlink: options.unlink,
    })
    for (const line of result.lines) {
      console.log(line)
    }
    for (const line of result.errors) {
      console.error(line)
    }
    if (!result.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

const invocation = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href
if (import.meta.url === invocation) {
  await main()
}
