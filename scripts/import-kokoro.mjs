#!/usr/bin/env node
/**
 * Thin CLI for W-M5-8: call the memory package Kokoro importer.
 *
 *   node scripts/import-kokoro.mjs --from <kokoro.db 或数据目录> --to <friend data dir>
 *
 * Does not invent a kokoro.db. Missing source files exit non-zero with a reason.
 */
import { access, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_IMPORTER_URL = pathToFileURL(
  join(SCRIPT_DIR, '../packages/dsh-friend-memory/lib/index.js'),
).href

export const USAGE = 'usage: node scripts/import-kokoro.mjs --from <kokoro.db 或数据目录> --to <friend data dir>'

export function usage() {
  return USAGE
}

export function parseArgs(argv) {
  let from
  let to
  let help = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }
    if (arg === '--from') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--from requires a path')
      }
      from = value
      index += 1
      continue
    }
    if (arg === '--to') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--to requires a path')
      }
      to = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return { help, from, to }
}

/**
 * `--from` may be the kokoro.db file or the directory that contains it.
 */
export async function resolveKokoroFrom(from, statImpl = stat) {
  const resolved = resolve(from)
  let info
  try {
    info = await statImpl(resolved)
  } catch {
    throw new Error(`source not found: ${resolved}`)
  }
  if (info.isFile()) {
    if (basename(resolved) !== 'kokoro.db') {
      throw new Error(`expected kokoro.db, got ${basename(resolved)}`)
    }
    return { fromDir: dirname(resolved), dbPath: resolved }
  }
  if (info.isDirectory()) {
    return { fromDir: resolved, dbPath: join(resolved, 'kokoro.db') }
  }
  throw new Error(`source is neither a file nor a directory: ${resolved}`)
}

export async function assertReadableFile(path, accessImpl = access) {
  try {
    await accessImpl(path)
  } catch {
    throw new Error(`kokoro.db not found: ${path}`)
  }
}

export function formatReport(report) {
  return JSON.stringify(report, null, 2)
}

export async function loadImporter(importerUrl = DEFAULT_IMPORTER_URL) {
  const mod = await import(importerUrl)
  if (typeof mod.importKokoro !== 'function') {
    throw new Error('memory package did not export importKokoro')
  }
  return mod.importKokoro
}

export async function runImportKokoro(options = {}) {
  const writeLog = options.log ?? ((line) => console.log(line))
  const writeError = options.error ?? ((line) => console.error(line))

  let parsed
  try {
    parsed = parseArgs(options.argv ?? [])
  } catch (error) {
    writeError(error instanceof Error ? error.message : String(error))
    writeError(usage())
    return 2
  }

  if (parsed.help) {
    writeLog(usage())
    return 0
  }
  if (parsed.from === undefined || parsed.to === undefined) {
    writeError(usage())
    return 2
  }

  try {
    const source = await resolveKokoroFrom(parsed.from, options.stat)
    await assertReadableFile(source.dbPath, options.access)
    const importKokoro = options.importKokoro ?? await loadImporter(options.importerUrl)
    const report = await importKokoro({
      fromDir: source.fromDir,
      dataDir: resolve(parsed.to),
    })
    writeLog(formatReport(report))
    return 0
  } catch (error) {
    writeError(error instanceof Error ? error.message : String(error))
    return 1
  }
}

async function main() {
  const code = await runImportKokoro({
    argv: process.argv.slice(2),
  })
  process.exitCode = code
}

const invocation = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href
if (import.meta.url === invocation) {
  await main()
}
