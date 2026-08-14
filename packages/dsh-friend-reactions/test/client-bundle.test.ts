import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const clientUrl = new URL('../lib/client.js', import.meta.url)

describe('dsh client half payload', () => {
  it('starts with the ModuleLoader factory wrapper', async () => {
    const source = await readFile(clientUrl, 'utf8')
    expect(source.startsWith('window.__ModuleLoader__.load({')).toBe(true)
    expect(source).toContain('id: "@wish233/dsh-friend-reactions"')
    expect(source).toContain('factory: (require) => {')
  })

  it('does not call require() for a third-party specifier inside the factory', async () => {
    const source = await readFile(clientUrl, 'utf8')
    const factoryStart = source.indexOf('factory: (require) => {')
    expect(factoryStart).toBeGreaterThan(-1)
    const factory = source.slice(factoryStart)
    expect(factory).not.toMatch(/\brequire\s*\(\s*['"](?!@wish233\/dsh-friend-shared\/universal)[^'"]+['"]\s*\)/)
    expect(factory).not.toMatch(/\brequire\s*\(\s*['"][^'"]+['"]\s*\)/)
  })
})
