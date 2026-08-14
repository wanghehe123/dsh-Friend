import { describe, expect, it } from 'vitest'

import {
  FRIEND_ASR_SECRET_FIELDS,
  readFriendAsrHostSettings,
  readFriendAsrSettings,
  sanitizeAsrSettingsForClient,
} from '../src/settings.ts'

const CANARY = 'sk-live-CANARY_dsh_friend_asr_key_leak_9b2e4d1f'

const HOST_DOCUMENT = {
  engine: 'endpoint',
  language: 'zh-CN',
  openaiApiKey: CANARY,
  openaiBaseURL: 'http://127.0.0.1:9/v1',
  openaiModel: 'whisper-1',
  openai: { apiKey: CANARY, baseURL: 'http://127.0.0.1:9/v1' },
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
  const walked = collectStringsAndKeys(value)
  expect(walked, `${label} deep walk`).not.toContain(CANARY)
  for (const field of FRIEND_ASR_SECRET_FIELDS) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      expect(Object.hasOwn(value, field), `${label} own field ${field}`).toBe(false)
    }
  }
}

describe('ASR endpoint key never reaches a client-readable snapshot', () => {
  it('keeps the canary on the host and strips it from the client view', () => {
    const host = readFriendAsrHostSettings(HOST_DOCUMENT)
    expect(host.openaiApiKey).toBe(CANARY)
    const snapshot = readFriendAsrSettings(HOST_DOCUMENT)
    expect(snapshot.hasApiKey).toBe(true)
    expect(snapshot.engine).toBe('endpoint')
    expect(snapshot.openaiBaseURL).toBe('http://127.0.0.1:9/v1')
    assertNoCanary(snapshot, 'readFriendAsrSettings')
    assertNoCanary(sanitizeAsrSettingsForClient(HOST_DOCUMENT), 'sanitizeAsrSettingsForClient')
  })
})
