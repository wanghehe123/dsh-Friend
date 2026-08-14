import { describe, expect, it } from 'vitest'

import { FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared'

import {
  CORE_SETTINGS_NAMESPACE,
  DEFAULT_REACTION_SETTINGS,
  REACTIONS_SETTINGS_NAMESPACE,
  reactionsAreLive,
  resolveReactionSettings,
} from '../src/settings.ts'

describe('reaction settings cascade', () => {
  it('uses kebab namespace constants, not handwritten strings', () => {
    expect(CORE_SETTINGS_NAMESPACE).toBe(FRIEND_SETTINGS_NAMESPACES.core)
    expect(REACTIONS_SETTINGS_NAMESPACE).toBe(FRIEND_SETTINGS_NAMESPACES.reactions)
    expect(CORE_SETTINGS_NAMESPACE).toBe('friend-core')
    expect(REACTIONS_SETTINGS_NAMESPACE).toBe('friend-reactions')
  })

  it('ANDs friend-core.enabled with friend-reactions.enabled', () => {
    expect(reactionsAreLive(true, true)).toBe(true)
    expect(reactionsAreLive(false, true)).toBe(false)
    expect(reactionsAreLive(true, false)).toBe(false)
    expect(reactionsAreLive(false, false)).toBe(false)
  })

  it('resolves enabled=false when the master switch is off', () => {
    const resolved = resolveReactionSettings({
      get(namespace) {
        if (namespace === FRIEND_SETTINGS_NAMESPACES.core) {
          return { enabled: false }
        }
        if (namespace === FRIEND_SETTINGS_NAMESPACES.reactions) {
          return { enabled: true, level: 'voice' }
        }
        return undefined
      },
    })
    expect(resolved.enabled).toBe(false)
    expect(resolved.level).toBe('voice')
  })

  it('resolves enabled=false when only the reactions switch is off', () => {
    const resolved = resolveReactionSettings({
      get(namespace) {
        if (namespace === FRIEND_SETTINGS_NAMESPACES.core) {
          return { enabled: true }
        }
        if (namespace === FRIEND_SETTINGS_NAMESPACES.reactions) {
          return { enabled: false }
        }
        return undefined
      },
    })
    expect(resolved.enabled).toBe(false)
  })

  it('defaults both switches on when settings are missing', () => {
    expect(resolveReactionSettings(undefined).enabled).toBe(DEFAULT_REACTION_SETTINGS.enabled)
  })
})
