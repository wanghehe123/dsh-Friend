import { describe, expect, it } from 'vitest'

import config from '../tsdown.config.ts'

describe('standalone pet bundle contract', () => {
  it('emits a browser-ready IIFE with the Cubism adapter bundled', () => {
    const petBuild = (config as Array<Record<string, unknown>>).find(
      (entry) => entry.name === '@wish233/dsh-friend-stage/pet',
    )
    const alwaysBundle = (petBuild?.deps as { alwaysBundle?: unknown[] } | undefined)?.alwaysBundle ?? []

    expect(petBuild).toMatchObject({
      entry: { pet: 'src/pet.ts' },
      format: 'iife',
    })
    expect(alwaysBundle.some((entry) => entry instanceof RegExp && entry.test('pixi-live2d-display/cubism4'))).toBe(true)
    expect(alwaysBundle).toEqual(expect.arrayContaining([
      '@wish233/dsh-friend-asr/browser',
      '@wish233/dsh-friend-shared/universal',
    ]))
  })
})
