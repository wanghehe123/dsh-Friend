import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url))
const SPECIFIER_RE = /(?:\bfrom\s+|import\s*\(\s*)['"]([^'"]+)['"]/g

const FORBIDDEN = [
  /from ['"]node:/,
  /\bwindow\b/,
  /\bdocument\b/,
  /pixi/i,
  /live2dcubism/i,
] as const

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

async function walkTagsGraph(entryFile: string): Promise<string[]> {
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

describe('stage ./tags lean export', () => {
  it('declares ./tags as naked ESM', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { exports: Record<string, { types?: string; default?: string }> }
    expect(manifest.exports['./tags']).toEqual({
      types: './lib/tags.d.ts',
      default: './lib/tags.js',
    })
  })

  it('keeps the tags source graph free of node builtins, browser globals, and Live2D/pet', async () => {
    const files = await walkTagsGraph(join(SRC_ROOT, 'tags.ts'))
    expect(files.some((file) => file.endsWith('/tags.ts'))).toBe(true)
    expect(files.some((file) => file.includes('/live2d/'))).toBe(false)
    expect(files.some((file) => file.endsWith('/pet.ts'))).toBe(false)
    expect(files.some((file) => file.endsWith('/index.ts'))).toBe(false)

    for (const file of files) {
      const raw = await readFile(file, 'utf8')
      const source = stripComments(raw)
      for (const pattern of FORBIDDEN) {
        expect(source, `${file} matches ${pattern}`).not.toMatch(pattern)
      }
    }
  })

  it('lib/tags.js is naked ESM and does not pull the host graph', async () => {
    const source = await readFile(new URL('../lib/tags.js', import.meta.url), 'utf8')
    const host = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
    expect(source.startsWith('window.')).toBe(false)
    expect(source).toMatch(/\bexport\s/)
    expect(source).not.toMatch(/node:/)
    expect(source).not.toContain('__ModuleLoader__')
    expect(source).not.toContain('pixi')
    expect(source).not.toContain('/friend/pet')
    expect(source.length).toBeLessThan(host.length)
    expect(source.length).toBeLessThan(16_384)
  })
})
