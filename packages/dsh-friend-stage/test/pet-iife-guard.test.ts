import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const bundleUrl = new URL('../lib/pet.iife.js', import.meta.url)
const bundlePath = fileURLToPath(bundleUrl)
const present = existsSync(bundlePath)

describe('pet IIFE must bundle pixi-live2d-display', () => {
  it.skipIf(!present)('inlines pixi-live2d-display and does not leave cubism4 as an external', async () => {
    const source = await readFile(bundleUrl, 'utf8')
    expect(source).toContain('pixi-live2d-display')
    expect(source).not.toContain('pixi_live2d_display_cubism4')
    expect(source).not.toContain('_wishp3_dsh_friend_shared')
    expect(source.startsWith('var DshFriendPet = (function(exports)')).toBe(true)
  })

  it('explains how to build when lib/pet.iife.js is missing', () => {
    if (present) return
    console.warn('SKIP pet IIFE guard: lib/pet.iife.js is missing. Run `pnpm --filter @wishp3/dsh-friend-stage build` first.')
    expect(present).toBe(false)
  })
})
