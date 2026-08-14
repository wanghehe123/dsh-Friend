import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const clientUrl = new URL('../lib/client.js', import.meta.url)

const PLATFORM_REQUIRE = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-primitives',
])

describe('dsh client half payload', () => {
  it('starts with the ModuleLoader factory wrapper', async () => {
    const source = await readFile(clientUrl, 'utf8')
    expect(source.startsWith('window.__ModuleLoader__.load({')).toBe(true)
    expect(source).toContain('id: "@wish233/dsh-friend-settings"')
    expect(source).toContain('factory: (require) => {')
  })

  it('only requires platform seed modules inside the factory', async () => {
    const source = await readFile(clientUrl, 'utf8')
    const factoryStart = source.indexOf('factory: (require) => {')
    expect(factoryStart).toBeGreaterThan(-1)
    const factory = source.slice(factoryStart)
    const requires = [...factory.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1])
    for (const specifier of requires) {
      expect(PLATFORM_REQUIRE.has(specifier ?? ''), `unexpected require(${specifier})`).toBe(true)
    }
  })

  it('materializes apply() without touching the react seed', async () => {
    const source = await readFile(clientUrl, 'utf8')
    const factories = new Map<string, (requireFn: (spec: string) => unknown) => unknown>()
    const loader = {
      load(handoff: { id: string; factory: (requireFn: (spec: string) => unknown) => unknown }) {
        factories.set(handoff.id, handoff.factory)
      },
    }
    const previous = (globalThis as { window?: { __ModuleLoader__?: typeof loader } }).window
    ;(globalThis as { window: { __ModuleLoader__: typeof loader } }).window = { __ModuleLoader__: loader }
    try {
      new Function(source)()
    } finally {
      if (previous === undefined) {
        delete (globalThis as { window?: unknown }).window
      } else {
        (globalThis as { window: typeof previous }).window = previous
      }
    }
    const factory = factories.get('@wish233/dsh-friend-settings')
    expect(factory).toBeTypeOf('function')
    const exported = factory?.((spec) => {
      throw new Error(`factory evaluation must not require("${spec}")`)
    }) as { apply?: unknown }
    expect(exported.apply).toBeTypeOf('function')
  })
})
