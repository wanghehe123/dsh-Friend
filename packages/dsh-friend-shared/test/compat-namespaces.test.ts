import { describe, expect, it } from 'vitest'

import { FRIEND_SETTINGS_NAMESPACES } from '../src/compat/namespaces.ts'

describe('FRIEND_SETTINGS_NAMESPACES', () => {
  it('exports kebab constants that pass settingsNamespace()\'s pattern', () => {
    const official = /^[a-z][a-z0-9-]*$/
    const values = Object.values(FRIEND_SETTINGS_NAMESPACES)
    expect(values).toEqual([
      'friend-core',
      'friend-persona',
      'friend-memory',
      'friend-tts',
      'friend-asr',
      'friend-stage',
      'friend-growth',
      'friend-reactions',
      'friend-pet',
    ])
    for (const ns of values) {
      expect(ns).toMatch(official)
      expect(ns).not.toContain('.')
    }
  })
})
