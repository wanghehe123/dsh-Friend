import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared/universal'
import { describe, expect, it } from 'vitest'

import { asFriendHostSettings, parseSettingsPatch } from '../src/patch.ts'

describe('parseSettingsPatch', () => {
  it('accepts a registered friend-* namespace and a plain patch', () => {
    expect(parseSettingsPatch({
      namespace: FRIEND_SETTINGS_NAMESPACES.asr,
      patch: { hotkey: 'Alt+Q', language: 'en-US' },
    })).toEqual({
      ok: true,
      value: {
        namespace: 'friend-asr',
        patch: { hotkey: 'Alt+Q', language: 'en-US' },
      },
    })
  })

  it('rejects unknown namespaces and illegal patches with 4xx-shaped errors', () => {
    expect(parseSettingsPatch(null).ok).toBe(false)
    expect(parseSettingsPatch({ namespace: 'friend-asr' }).ok).toBe(false)
    expect(parseSettingsPatch({
      namespace: 'friend.asr',
      patch: { hotkey: 'Alt+Q' },
    })).toMatchObject({ ok: false, error: 'unknown namespace: friend.asr' })
    expect(parseSettingsPatch({
      namespace: 'friend-shell',
      patch: { token: 'x' },
    }).ok).toBe(false)
    expect(parseSettingsPatch({
      namespace: FRIEND_SETTINGS_NAMESPACES.asr,
      patch: ['hotkey'],
    })).toMatchObject({ ok: false, error: 'patch must be an object' })
    expect(parseSettingsPatch(JSON.parse(
      '{"namespace":"friend-tts","patch":{"__proto__":{"admin":true}}}',
    ))).toMatchObject({ ok: false, error: 'illegal patch key' })
  })
})

describe('asFriendHostSettings', () => {
  it('returns the live object only when update is a function', () => {
    const live = {
      get() {
        return {}
      },
      async update() {},
    }
    expect(asFriendHostSettings(live)).toBe(live)
    expect(asFriendHostSettings({ get() { return {} } })).toBeUndefined()
    expect(asFriendHostSettings(undefined)).toBeUndefined()
  })
})
