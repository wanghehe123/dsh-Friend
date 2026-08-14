#!/usr/bin/env node
/**
 * W-M8-6 / W-M4-2: scan npm publish **file names**, never file contents.
 *
 * `lib/pet.iife.js` may mention the global `Live2DCubismCore`. A content
 * search for `live2dcubismcore` would false-positive. Forbidden is shipping
 * Cubism Core or Live2D model **files** (`.moc3`, `.model3.json`,
 * `live2dcubismcore.min.js`, …).
 *
 * Usage:
 *   node scripts/release-scan.mjs [--root <dir>] [--pack]
 *   node scripts/release-scan.mjs --package <dir> [--pack]
 *   node scripts/release-scan.mjs --pack --check-versions [--tag v0.1.0]
 *   node scripts/release-scan.mjs --pack --require-publishable
 *
 * `--pack` lists each tarball via `npm pack --dry-run --json` (same file
 * set `pnpm pack` would ship). Without `--pack`, only the package `files`
 * globs on disk are walked — tests use `--pack` against fixtures.
 */
import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Basenames / suffixes that must not appear in a published tarball. */
export const FORBIDDEN_BASENAME_EXACT = Object.freeze([
  'live2dcubismcore.min.js',
  'live2dcubismcore.js',
])

export const FORBIDDEN_SUFFIXES = Object.freeze(['.moc3', '.model3.json', '.moc'])

export function usage() {
  return [
    'Usage: node scripts/release-scan.mjs [--root <dir>] [--pack]',
    '       [--package <dir>] [--check-versions] [--tag <vX.Y.Z|npm-vX.Y.Z>]',
    '       [--require-publishable]',
  ].join('\n')
}

export function parseArgs(argv) {
  let root = DEFAULT_ROOT
  let pack = false
  let checkVersions = false
  let requirePublishable = false
  let tag
  const packages = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--root') {
      root = resolve(argv[index + 1] ?? '')
      index += 1
      continue
    }
    if (arg === '--package') {
      packages.push(resolve(argv[index + 1] ?? ''))
      index += 1
      continue
    }
    if (arg === '--tag') {
      tag = argv[index + 1]
      index += 1
      continue
    }
    if (arg === '--pack') {
      pack = true
      continue
    }
    if (arg === '--check-versions') {
      checkVersions = true
      continue
    }
    if (arg === '--require-publishable') {
      requirePublishable = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      return { help: true, root, pack, checkVersions, requirePublishable, tag, packages }
    }
    throw new Error(`unknown argument: ${arg}\n${usage()}`)
  }

  return { help: false, root, pack, checkVersions, requirePublishable, tag, packages }
}

export function isForbiddenPublishPath(relPath) {
  const normalized = String(relPath)
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
  const base = normalized.split('/').pop() ?? ''
  const lower = base.toLowerCase()
  if (FORBIDDEN_BASENAME_EXACT.includes(lower)) {
    return true
  }
  return FORBIDDEN_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

export function parseTagVersion(tag) {
  if (typeof tag !== 'string' || tag.trim() === '') {
    return undefined
  }
  const trimmed = tag.trim()
  const stripped = trimmed.replace(/^(?:refs\/tags\/)?(?:npm-v|shell-v|v)/u, '')
  return stripped === '' ? undefined : stripped
}

export function extractJsonValue(stdout) {
  const text = String(stdout).trim()
  if (text === '') {
    throw new Error('npm pack produced empty output')
  }
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const arrayStart = text.indexOf('[')
    const cut = start === -1 ? arrayStart : arrayStart === -1 ? start : Math.min(start, arrayStart)
    if (cut === -1) {
      throw new Error('npm pack output was not JSON')
    }
    return JSON.parse(text.slice(cut))
  }
}

export function packedPathsFromNpmJson(value) {
  const records = Array.isArray(value) ? value : [value]
  const paths = []
  for (const record of records) {
    if (record === null || typeof record !== 'object') {
      continue
    }
    const files = record.files
    if (!Array.isArray(files)) {
      continue
    }
    for (const file of files) {
      if (typeof file === 'string') {
        paths.push(file)
        continue
      }
      if (file !== null && typeof file === 'object' && typeof file.path === 'string') {
        paths.push(file.path)
      }
    }
  }
  return paths
}

export async function listPackedFiles(packageDir) {
  const { stdout } = await execFileAsync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: packageDir, env: { ...process.env, npm_config_loglevel: 'error' } },
  )
  return packedPathsFromNpmJson(extractJsonValue(stdout))
}

async function walkFiles(dir, acc = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue
      }
      await walkFiles(full, acc)
      continue
    }
    if (entry.isFile()) {
      acc.push(full)
    }
  }
  return acc
}

export async function listFilesFieldOnDisk(packageDir, filesField) {
  const globs = Array.isArray(filesField) && filesField.length > 0 ? filesField : ['lib']
  const found = []
  for (const glob of globs) {
    const target = join(packageDir, glob)
    let info
    try {
      info = await stat(target)
    } catch {
      continue
    }
    if (info.isFile()) {
      found.push(glob.replaceAll('\\', '/'))
      continue
    }
    if (info.isDirectory()) {
      const children = await walkFiles(target)
      for (const child of children) {
        found.push(relative(packageDir, child).split(sep).join('/'))
      }
    }
  }
  return found
}

export async function readPackageJson(packageDir) {
  const raw = await readFile(join(packageDir, 'package.json'), 'utf8')
  return JSON.parse(raw)
}

export async function collectWorkspacePackages(root) {
  const packagesDir = join(root, 'packages')
  let names
  try {
    names = await readdir(packagesDir)
  } catch {
    return []
  }
  const dirs = []
  for (const name of names) {
    const dir = join(packagesDir, name)
    try {
      const info = await stat(join(dir, 'package.json'))
      if (info.isFile()) {
        dirs.push(dir)
      }
    } catch {
      // skip
    }
  }
  dirs.sort()
  return dirs
}

export function licenseReport(manifest) {
  const warnings = []
  if (manifest.private === true) {
    warnings.push('private: true (npm publish will skip this package)')
  }
  if (typeof manifest.license !== 'string' || manifest.license.trim() === '') {
    warnings.push('missing license field')
  }
  return warnings
}

export async function scan(options) {
  const packageDirs =
    options.packages.length > 0 ? options.packages : await collectWorkspacePackages(options.root)

  if (packageDirs.length === 0) {
    throw new Error('no packages to scan')
  }

  const hits = []
  const listings = []
  const warnings = []
  const versions = []

  for (const dir of packageDirs) {
    const manifest = await readPackageJson(dir)
    const name = typeof manifest.name === 'string' ? manifest.name : dir
    const version = typeof manifest.version === 'string' ? manifest.version : ''
    versions.push({ name, version, dir, private: manifest.private === true })
    for (const warning of licenseReport(manifest)) {
      warnings.push(`${name}: ${warning}`)
    }

    const paths = options.pack
      ? await listPackedFiles(dir)
      : await listFilesFieldOnDisk(dir, manifest.files)
    listings.push({ name, dir, paths })
    for (const rel of paths) {
      if (isForbiddenPublishPath(rel)) {
        hits.push({ name, path: rel })
      }
    }
  }

  const versionErrors = []
  if (options.checkVersions) {
    const unique = [...new Set(versions.map((item) => item.version).filter(Boolean))]
    if (unique.length !== 1) {
      versionErrors.push(
        `workspace package versions diverge: ${versions
          .map((item) => `${item.name}@${item.version || '?'}`)
          .join(', ')}`,
      )
    }
    const expected = parseTagVersion(options.tag)
    if (expected !== undefined && unique.length === 1 && unique[0] !== expected) {
      versionErrors.push(`tag ${options.tag} does not match package version ${unique[0]}`)
    }
    if (expected !== undefined && unique.length !== 1) {
      versionErrors.push(`tag ${options.tag} cannot be matched while versions diverge`)
    }
  }

  const publishableErrors = []
  if (options.requirePublishable) {
    for (const item of versions) {
      const manifest = await readPackageJson(item.dir)
      for (const warning of licenseReport(manifest)) {
        publishableErrors.push(`${item.name}: ${warning}`)
      }
    }
  }

  return { hits, listings, warnings, versions, versionErrors, publishableErrors }
}

function printReport(result) {
  for (const listing of result.listings) {
    console.log(`${listing.name}: ${listing.paths.length} packed path(s)`)
  }
  if (result.warnings.length > 0) {
    console.log('license / publish notes (not a scan failure):')
    for (const warning of result.warnings) {
      console.log(`  - ${warning}`)
    }
  }
  if (result.hits.length > 0) {
    console.error('forbidden publish files:')
    for (const hit of result.hits) {
      console.error(`  - ${hit.name}: ${hit.path}`)
    }
  }
  for (const error of result.versionErrors) {
    console.error(error)
  }
  for (const error of result.publishableErrors) {
    console.error(error)
  }
}

export function exitCodeFor(result) {
  if (result.hits.length > 0) {
    return 1
  }
  if (result.versionErrors.length > 0) {
    return 1
  }
  if (result.publishableErrors.length > 0) {
    return 1
  }
  return 0
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(usage())
    return 0
  }
  const result = await scan(options)
  printReport(result)
  const code = exitCodeFor(result)
  if (code === 0) {
    console.log('release-scan: ok (no forbidden publish files)')
  }
  return code
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
