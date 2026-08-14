/**
 * Repo-level guard: every client half must declare the same inject list in
 * `package.json` `dsh.client.inject` and the module `export const inject`.
 *
 * The strict ctx suite only reads the module export. Cordis / dsh web only
 * honour the package.json list. A mismatch is a real browser crash
 * (`cannot get property "…" without inject`).
 */
import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES_DIR = join(ROOT, 'packages')

type ClientManifest = {
  name?: string
  dsh?: {
    client?: {
      inject?: unknown
    }
  }
}

type Alignment = {
  packageName: string
  dir: string
  fromManifest: string[]
  fromModule: string[]
}

function posixRel(from: string, to: string): string {
  return relative(from, to).split(sep).join('/')
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if (isErrno(error) && error.code === 'ENOENT') return false
    throw error
  }
}

function asInjectList(value: unknown, label: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a string array, got ${typeof value}`)
  }
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new Error(`${label} contains a non-string entry`)
    }
    out.push(item)
  }
  return out
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((name, index) => name === right[index])
}

function formatMismatch(item: Alignment): string {
  return [
    `${item.packageName} (${posixRel(ROOT, item.dir)})`,
    `  package.json dsh.client.inject = ${JSON.stringify(item.fromManifest)}`,
    `  export const inject             = ${JSON.stringify(item.fromModule)}`,
    `  Cordis uses the package.json list; the strict ctx suite uses the module export.`,
    `  A mismatch is a real browser crash (cannot get property "…" without inject).`,
  ].join('\n')
}

async function listClientHalves(): Promise<Alignment[]> {
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true })
  const found: Alignment[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(PACKAGES_DIR, entry.name)
    const manifestPath = join(dir, 'package.json')
    if (!(await fileExists(manifestPath))) continue
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ClientManifest
    if (manifest.dsh?.client === undefined) continue
    const clientPath = join(dir, 'src/client.ts')
    if (!(await fileExists(clientPath))) {
      throw new Error(
        `${manifest.name ?? entry.name} declares dsh.client but has no src/client.ts`,
      )
    }
    const packageName = manifest.name ?? entry.name
    const fromManifest = asInjectList(
      manifest.dsh.client.inject,
      `${packageName} package.json dsh.client.inject`,
    )
    const mod = await import(pathToFileURL(clientPath).href) as { inject?: unknown }
    const fromModule = asInjectList(mod.inject, `${packageName} export const inject`)
    found.push({ packageName, dir, fromManifest, fromModule })
  }
  return found
}

describe('dsh.client.inject alignment', () => {
  it('matches package.json dsh.client.inject to each client module export const inject', async () => {
    const halves = await listClientHalves()
    expect(halves, 'expected at least one package with dsh.client').not.toEqual([])
    const mismatches = halves.filter((item) => !sameList(item.fromManifest, item.fromModule))
    expect(mismatches, mismatches.map(formatMismatch).join('\n\n')).toEqual([])
  })
})
