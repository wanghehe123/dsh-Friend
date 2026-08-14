/**
 * W-M2-3 dedicated assertion: openai-compat API key stays on the host.
 *
 * A unique canary is planted in every host-shaped document we accept and
 * must be absent from every client-readable snapshot we produce — including
 * JSON serialization and a deep walk of keys + string values.
 */
import { describe, expect, it } from 'vitest'

import {
  FRIEND_TTS_SECRET_FIELDS,
  bindTtsSettings,
  readFriendTtsHostSettings,
  sanitizeTtsSettingsForClient,
  toClientTtsSnapshot,
  type FriendTtsClientSnapshot,
  type TtsSettingsBinder,
  type TtsSettingsScope,
} from '../src/settings.ts'

/** Unique per file so a leftover fixture cannot accidentally match. */
const CANARY = 'sk-live-CANARY_dsh_friend_tts_key_leak_7f3e9a2c'

const HOST_DOCUMENT = {
  provider: 'openai-compat',
  voice: 'alloy',
  rate: 1.1,
  pitch: 1,
  autoSpeak: true,
  stripStageDirections: true,
  volume: 0.8,
  muted: false,
  openaiApiKey: CANARY,
  openaiBaseURL: 'http://127.0.0.1:9/v1',
  openaiModel: 'tts-1',
  openai: {
    apiKey: CANARY,
    baseURL: 'http://127.0.0.1:9/v1',
    model: 'tts-1',
  },
  apiKey: CANARY,
}

function collectStringsAndKeys(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value)
    return out
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringsAndKeys(item, out)
    }
    return out
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      out.push(key)
      collectStringsAndKeys(child, out)
    }
  }
  return out
}

function assertNoCanary(value: unknown, label: string): void {
  const serialized = JSON.stringify(value)
  expect(serialized, `${label} JSON`).not.toContain(CANARY)
  expect(serialized.toLowerCase(), `${label} JSON lower`).not.toContain(CANARY.toLowerCase())
  const walked = collectStringsAndKeys(value)
  expect(walked, `${label} deep walk`).not.toContain(CANARY)
  for (const field of FRIEND_TTS_SECRET_FIELDS) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      expect(Object.hasOwn(value, field), `${label} own field ${field}`).toBe(false)
    }
  }
}

describe('openai-compat key never reaches a client-readable snapshot', () => {
  it('keeps the canary on the host document and strips it from toClientTtsSnapshot', () => {
    const host = readFriendTtsHostSettings(HOST_DOCUMENT)
    expect(host.openaiApiKey).toBe(CANARY)

    const snapshot = toClientTtsSnapshot(HOST_DOCUMENT)
    expect(snapshot.hasApiKey).toBe(true)
    expect(snapshot.provider).toBe('openai-compat')
    expect(snapshot.autoSpeak).toBe(true)
    expect(snapshot.stripStageDirections).toBe(true)
    expect(snapshot.volume).toBe(0.8)
    expect(snapshot.muted).toBe(false)
    expect(snapshot.openaiBaseURL).toBe('http://127.0.0.1:9/v1')
    expect(snapshot.openaiModel).toBe('tts-1')
    assertNoCanary(snapshot, 'toClientTtsSnapshot')
  })

  it('sanitizeTtsSettingsForClient drops every secret field, including nested openai.apiKey', () => {
    const cleaned = sanitizeTtsSettingsForClient(HOST_DOCUMENT)
    assertNoCanary(cleaned, 'sanitizeTtsSettingsForClient')
    expect(cleaned).toMatchObject({
      provider: 'openai-compat',
      voice: 'alloy',
      openaiBaseURL: 'http://127.0.0.1:9/v1',
      openai: {
        baseURL: 'http://127.0.0.1:9/v1',
        model: 'tts-1',
      },
    })
  })

  it('bindTtsSettings decode writes only the sanitized snapshot into scope.value', () => {
    let decoded: FriendTtsClientSnapshot | undefined
    const binder: TtsSettingsBinder = {
      bind(spec) {
        decoded = spec.decode?.(HOST_DOCUMENT)
        const scope: TtsSettingsScope = {
          getSnapshot: () => ({
            status: 'ready',
            value: decoded,
            // Official binders may keep a raw host copy on base/user.
            // Client UI must read `value` (the decode result), never base/user.
            base: HOST_DOCUMENT,
            user: HOST_DOCUMENT,
            revision: 1,
            writable: true,
            mode: 'host',
          }),
          subscribe: () => () => {},
          set: async () => {},
          unset: async () => {},
        }
        return scope
      },
    }

    const scope = bindTtsSettings(binder)
    const value = scope.getSnapshot().value
    expect(value).toBeDefined()
    expect(value?.hasApiKey).toBe(true)
    assertNoCanary(value, 'settingsScope.value')
    assertNoCanary(decoded, 'decode() return')
  })

  it('a document without a key reports hasApiKey false and still has no canary', () => {
    const snapshot = toClientTtsSnapshot({
      provider: 'edge',
      voice: 'zh-CN-XiaoxiaoNeural',
    })
    expect(snapshot.hasApiKey).toBe(false)
    assertNoCanary(snapshot, 'edge-only snapshot')
  })
})
