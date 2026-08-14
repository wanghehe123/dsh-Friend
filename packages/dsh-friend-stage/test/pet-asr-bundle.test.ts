import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const bundleUrl = new URL('../lib/pet.iife.js', import.meta.url)
const present = existsSync(fileURLToPath(bundleUrl))

describe('pet IIFE inlines the asr browser client', () => {
  it.skipIf(!present)('bundles startAsrClient without ModuleLoader or workspace externals', async () => {
    const source = await readFile(bundleUrl, 'utf8')
    expect(source).toContain('pixi-live2d-display')
    expect(source).toContain('/friend/asr/transcribe')
    expect(source).toContain('SpeechRecognition')
    expect(source).toContain('/friend/stage/chat')
    expect(source).toContain('/friend/settings/snapshot')
    expect(source).toContain('hotkey-down')
    expect(source).not.toMatch(/window\.__ModuleLoader__\.load/)
    expect(source).not.toContain('_wish233_dsh_friend_asr')
    expect(source).not.toContain('_wish233_dsh_friend_shared')
    expect(source).not.toContain('pixi_live2d_display_cubism4')
    expect(source.startsWith('var DshFriendPet = (function(exports)')).toBe(true)
  })
})
