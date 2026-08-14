import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const clientUrl = new URL('../lib/client.js', import.meta.url)

describe('dsh client half payload', () => {
  it('starts with the ModuleLoader factory wrapper', async () => {
    const source = await readFile(clientUrl, 'utf8')
    expect(source.startsWith('window.__ModuleLoader__.load({')).toBe(true)
    expect(source).toContain('id: "@wishp3/dsh-friend-asr"')
    expect(source).toContain('factory: (require) => {')
  })

  it('does not call require() inside the factory', async () => {
    const source = await readFile(clientUrl, 'utf8')
    expect(source).not.toMatch(/\brequire\s*\(/)
  })
})
