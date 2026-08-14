import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  FRIEND_EVENTS_PATH,
  FRIEND_SETTINGS_NAMESPACES,
} from '../src/universal.ts'

const UNIVERSAL_GRAPH = [
  '../src/universal.ts',
  '../src/compat/events.ts',
  '../src/compat/namespaces.ts',
] as const

describe('shared universal entry', () => {
  it('exports kebab namespaces and the SSE path as plain values', () => {
    expect(FRIEND_EVENTS_PATH).toBe('/friend/events')
    expect(FRIEND_SETTINGS_NAMESPACES.asr).toBe('friend-asr')
  })

  it('declares the ./universal subpath as naked ESM', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, { types?: string; default?: string }>
    }
    expect(manifest.exports['./universal']).toEqual({
      types: './lib/universal.d.ts',
      default: './lib/universal.js',
    })
  })

  it('does not pull node builtins or browser globals into the universal graph', async () => {
    const forbidden = [
      /from ['"]node:/,
      /\bwindow\b/,
      /\bdocument\b/,
      /from ['"]@deepseek-ai\/dsh-host-webserver['"]/,
      /from ['"]@deepseek-ai\/dsh-tools['"]/,
      /from ['"]@deepseek-ai\/dsh-settings['"]/,
      /from ['"]@deepseek-ai\/schemastery['"]/,
    ]
    for (const relative of UNIVERSAL_GRAPH) {
      const raw = await readFile(new URL(relative, import.meta.url), 'utf8')
      const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      for (const pattern of forbidden) {
        expect(source, `${relative} matches ${pattern}`).not.toMatch(pattern)
      }
    }
  })

  it('lib/universal.js is naked ESM, not a ModuleLoader payload', async () => {
    const source = await readFile(new URL('../lib/universal.js', import.meta.url), 'utf8')
    expect(source.startsWith('window.')).toBe(false)
    expect(source).toMatch(/\bexport\s/)
    expect(source).not.toMatch(/node:/)
    expect(source).toContain('friend-asr')
    expect(source).toContain('/friend/events')
  })
})
