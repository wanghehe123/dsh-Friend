#!/usr/bin/env node
/**
 * One-shot Kokoro → dsh-Friend importer.
 * Lives in this package because the repo-root `scripts/` tree is owned by
 * other milestones. Invoke:
 *
 *   node packages/dsh-friend-memory/scripts/import-kokoro.mjs --from <kokoro-app-data> --to <friend-data-dir>
 */
import { pathToFileURL } from 'node:url'

function arg(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  return process.argv[index + 1]
}

const fromDir = arg('--from')
const dataDir = arg('--to')
if (!fromDir || !dataDir) {
  console.error('usage: node packages/dsh-friend-memory/scripts/import-kokoro.mjs --from <kokoro-dir> --to <friend-data-dir>')
  process.exit(2)
}

const mod = await import(pathToFileURL(new URL('../lib/index.js', import.meta.url)).href)
const report = await mod.importKokoro({ fromDir, dataDir })
console.log(JSON.stringify(report, null, 2))
