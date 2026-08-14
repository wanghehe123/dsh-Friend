import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url))
const SPECIFIER_RE = /(?:\bfrom\s+|import\s*\(\s*)['"]([^'"]+)['"]/g

const FORBIDDEN_SOURCE = [
  /from ['"]node:/,
  /from ['"]@wishp3\/dsh-friend-shared['"]/,
  /from ['"]@wishp3\/dsh-friend-shared\/client['"]/,
  /from ['"]@deepseek-ai\//,
] as const

const FORBIDDEN_FILES = [
  '/index.ts',
  '/client.ts',
  '/proxy.ts',
  '/routes.ts',
  '/settings-form.ts',
] as const

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

async function walkBrowserGraph(entryFile: string): Promise<string[]> {
  const seen = new Set<string>()
  const queue = [entryFile]
  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)
    const raw = await readFile(file, 'utf8')
    SPECIFIER_RE.lastIndex = 0
    for (const match of stripComments(raw).matchAll(SPECIFIER_RE)) {
      const spec = match[1]
      if (spec === undefined || !spec.startsWith('.')) continue
      const resolved = fileURLToPath(new URL(spec, `file://${file}`))
      if (resolved.startsWith(SRC_ROOT)) queue.push(resolved)
    }
  }
  return [...seen].sort()
}

describe('asr ./browser lean export', () => {
  it('declares ./browser as naked ESM', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { exports: Record<string, { types?: string; default?: string }> }
    expect(manifest.exports['./browser']).toEqual({
      types: './lib/browser.d.ts',
      default: './lib/browser.js',
    })
  })

  it('keeps the browser source graph free of node builtins, host shared, and dsh packages', async () => {
    const files = await walkBrowserGraph(join(SRC_ROOT, 'browser.ts'))
    expect(files.some((file) => file.endsWith('/browser.ts'))).toBe(true)
    expect(files.some((file) => file.endsWith('/settings.ts'))).toBe(true)
    expect(files.some((file) => file.endsWith('/engines/webspeech.ts'))).toBe(true)
    expect(files.some((file) => file.endsWith('/engines/endpoint.ts'))).toBe(true)

    for (const file of files) {
      for (const suffix of FORBIDDEN_FILES) {
        expect(file.endsWith(suffix), `${file} is host/client-only`).toBe(false)
      }
      const raw = await readFile(file, 'utf8')
      const source = stripComments(raw)
      for (const pattern of FORBIDDEN_SOURCE) {
        expect(source, `${file} matches ${pattern}`).not.toMatch(pattern)
      }
      const sharedImports = [...source.matchAll(/from ['"](@wishp3\/[^'"]+)['"]/g)].map((row) => row[1])
      for (const spec of sharedImports) {
        expect(spec).toBe('@wishp3/dsh-friend-shared/universal')
      }
    }
  })

  it('lib/browser.js is naked ESM, not a ModuleLoader payload, and has no node:', async () => {
    const source = await readFile(new URL('../lib/browser.js', import.meta.url), 'utf8')
    const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
    const stripped = stripComments(source)
    expect(source.startsWith('window.')).toBe(false)
    expect(source).toMatch(/\bexport\s/)
    expect(source).toContain('startAsrClient')
    expect(stripped).not.toMatch(/from ['"]node:/)
    expect(stripped).not.toMatch(/\brequire\(['"]node:/)
    expect(stripped).not.toMatch(/window\.__ModuleLoader__/)
    expect(client.startsWith('window.__ModuleLoader__.load({')).toBe(true)
    expect(source.length).toBeLessThan(client.length)
  })
})
