#!/usr/bin/env node
/**
 * Fail the build when pixi-live2d-display unpacked as an empty shell.
 *
 * pixi-live2d-display@0.4.0 ships tarball directories without the execute
 * bit (`drw-rw-rw-` / `drw-r--r--`). On macOS, extractors that honor those
 * modes cannot enter the directories, so pnpm may leave an empty folder.
 * The stage pet IIFE then silently degrades.
 *
 * `packages/dsh-friend-stage/vendor-integrity.json` is for official Live2D
 * downloads (Hiyori / Cubism Core), not this npm package. Do not vendor
 * pixi-live2d-display into git.
 *
 * Usage:
 *   node scripts/check-pixi-live2d.mjs [--root <workspace>]
 *   node scripts/check-pixi-live2d.mjs --package <dir>
 */
import { createRequire } from 'node:module'
import { access, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const PACKAGE_NAME = 'pixi-live2d-display'
export const EXPECTED_VERSION = '0.4.0'
export const STAGE_PACKAGE = 'dsh-friend-stage'

/** Any one file from each group must exist and be non-empty. */
export const REQUIRED_DIST_GROUPS = Object.freeze([
  Object.freeze(['dist/index.js', 'dist/index.es.js']),
  Object.freeze(['dist/cubism4.js', 'dist/cubism4.es.js']),
])

export function usage() {
  return [
    'Usage: node scripts/check-pixi-live2d.mjs [--root <workspace>]',
    '       node scripts/check-pixi-live2d.mjs --package <dir>',
  ].join('\n')
}

export function parseArgs(argv) {
  let root = DEFAULT_ROOT
  let packageDir
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--root') {
      root = resolve(argv[index + 1] ?? '')
      index += 1
      continue
    }
    if (arg === '--package') {
      packageDir = resolve(argv[index + 1] ?? '')
      index += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      return { help: true, root, packageDir }
    }
    throw new Error(`unknown argument: ${arg}\n${usage()}`)
  }
  return { help: false, root, packageDir }
}

export function repairSteps() {
  return [
    'Do not vendor pixi-live2d-display into git.',
    'Repair (use a temp directory; do not touch ~/.dsh):',
    '  1. export CI=true',
    `  2. In os.tmpdir(): npm pack ${PACKAGE_NAME}@${EXPECTED_VERSION}`,
    '  3. Extract the tarball, then chmod -R a+X the tree so directories are enterable',
    '     (the tarball records package/, package/cubism, package/cubism/.vscode,',
    '     and package/dist without the execute bit).',
    '  4. Copy package.json and dist/ into the pnpm virtual-store path:',
    `     node_modules/.pnpm/${PACKAGE_NAME}@${EXPECTED_VERSION}_*/node_modules/${PACKAGE_NAME}/`,
    '  5. Re-run: node scripts/check-pixi-live2d.mjs && pnpm --filter @wish233/dsh-friend-stage build',
    'See docs/dev-loop.md §3.5.',
  ].join('\n')
}

export function formatFailure(checkedPath, missing) {
  const lines = [
    `${PACKAGE_NAME} is missing or unpacked as an empty shell.`,
    `Checked: ${checkedPath}`,
    `Missing: ${missing.join(', ')}`,
    '',
    'Cause: the npm tarball for pixi-live2d-display@0.4.0 records directories',
    'without the execute bit (package/, package/cubism, package/cubism/.vscode,',
    'package/dist are often drw-r--r-- / drw-rw-rw-). On macOS, extractors that',
    'honor those modes cannot enter the directories, so pnpm may leave an empty',
    'folder. Live2D then silently degrades in lib/pet.iife.js.',
    '',
    repairSteps(),
  ]
  return lines.join('\n')
}

async function fileNonEmpty(path) {
  try {
    const info = await stat(path)
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}

async function dirExists(path) {
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

export async function inspectPixiPackage(packageDir) {
  const missing = []
  const packageJsonPath = join(packageDir, 'package.json')
  if (!(await fileNonEmpty(packageJsonPath))) {
    missing.push('package.json')
  } else {
    try {
      const manifest = JSON.parse(await readFile(packageJsonPath, 'utf8'))
      if (manifest === null || typeof manifest !== 'object' || manifest.name !== PACKAGE_NAME) {
        missing.push('package.json (name)')
      }
    } catch {
      missing.push('package.json (parse)')
    }
  }

  const distDir = join(packageDir, 'dist')
  if (!(await dirExists(distDir))) {
    missing.push('dist/')
  }

  for (const group of REQUIRED_DIST_GROUPS) {
    let found = false
    for (const rel of group) {
      if (await fileNonEmpty(join(packageDir, rel))) {
        found = true
        break
      }
    }
    if (!found) {
      missing.push(group.join(' | '))
    }
  }

  return { ok: missing.length === 0, packageDir, missing }
}

export function resolvePixiFromWorkspace(root) {
  const stageManifest = join(root, 'packages', STAGE_PACKAGE, 'package.json')
  const require = createRequire(stageManifest)
  try {
    return dirname(require.resolve(`${PACKAGE_NAME}/package.json`))
  } catch {
    return join(root, 'packages', STAGE_PACKAGE, 'node_modules', PACKAGE_NAME)
  }
}

export async function checkPixiLive2d(options) {
  const packageDir = options.packageDir ?? resolvePixiFromWorkspace(options.root)
  try {
    await access(packageDir)
  } catch {
    return {
      ok: false,
      packageDir,
      missing: ['package directory'],
      message: formatFailure(packageDir, ['package directory']),
    }
  }
  const result = await inspectPixiPackage(packageDir)
  return {
    ...result,
    message: result.ok ? `${PACKAGE_NAME}: ok (${packageDir})` : formatFailure(packageDir, result.missing),
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(usage())
    return 0
  }
  const result = await checkPixiLive2d(options)
  if (result.ok) {
    console.log(result.message)
    return 0
  }
  console.error(result.message)
  return 1
}

const invocation = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href
if (import.meta.url === invocation) {
  try {
    process.exitCode = await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
