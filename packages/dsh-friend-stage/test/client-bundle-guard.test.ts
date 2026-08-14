import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

describe('dsh client half must not load pixi', () => {
  it('lib/client.js is a ModuleLoader factory without pixi or live2d requires', async () => {
    const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
    expect(source.startsWith('window.__ModuleLoader__.load({')).toBe(true)
    expect(source).not.toContain('require("pixi')
    expect(source).not.toContain("require('pixi")
    expect(source).not.toContain('pixi-live2d-display')
    expect(source).not.toContain('require("pixi.js")')
    expect(source).toContain('/friend/pet?transparent=1&embed=1')
  })
})
