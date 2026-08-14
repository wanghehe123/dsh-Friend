import { describe, expect, it } from 'vitest'

import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared'

import {
  DEFAULT_MEMORY_SETTINGS,
  MEMORY_SETTINGS_NAMESPACE,
  readMemorySettings,
  resolveCurrentCharacterSlug,
} from '../src/settings.ts'

describe('memory settings', () => {
  it('reads the kebab friend-memory namespace and clamps fields', () => {
    expect(MEMORY_SETTINGS_NAMESPACE).toBe(FRIEND_SETTINGS_NAMESPACES.memory)
    expect(MEMORY_SETTINGS_NAMESPACE).toBe('friend-memory')
    const parsed = readMemorySettings({
      enabled: false,
      autoSummaryIdleMinutes: 99_000,
      distillHour: 25,
      memoryMaxBytes: 12,
    })
    expect(parsed.enabled).toBe(false)
    expect(parsed.autoSummaryIdleMinutes).toBe(24 * 60)
    expect(parsed.distillHour).toBe(23)
    expect(parsed.memoryMaxBytes).toBe(1024)
  })

  it('falls back to default slug when persona settings are missing', () => {
    expect(resolveCurrentCharacterSlug(undefined)).toBe('default')
    expect(resolveCurrentCharacterSlug({
      get: (namespace) => {
        expect(namespace).toBe(FRIEND_SETTINGS_NAMESPACES.persona)
        return { currentSlug: 'xiaoye' }
      },
    })).toBe('xiaoye')
  })

  it('uses documented defaults when the section is empty', () => {
    expect(readMemorySettings(undefined)).toEqual(DEFAULT_MEMORY_SETTINGS)
  })
})
