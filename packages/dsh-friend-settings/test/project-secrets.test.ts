/**
 * Client-readable aggregation must never carry host secrets.
 * A unique canary is planted in every host document we accept.
 */
import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared/universal'
import { describe, expect, it } from 'vitest'

import { createOfficialSanitizeSeams } from '../src/host-seams.ts'
import { projectDocuments } from '../src/project.ts'
import { FRIEND_SECRET_FIELDS, defaultProjectAsr, defaultProjectTts } from '../src/sanitize.ts'

const CANARY = 'sk-live-CANARY_dsh_friend_settings_key_leak_c4e91b70'

const HOST_DOCUMENTS = {
  [FRIEND_SETTINGS_NAMESPACES.core]: {
    enabled: true,
    floatEnabled: true,
    volume: 0.7,
    muted: false,
    language: 'zh',
  },
  [FRIEND_SETTINGS_NAMESPACES.persona]: {
    currentSlug: 'default',
    chatModel: {
      kind: 'openai-compat',
      baseURL: 'http://127.0.0.1:9/v1',
      model: 'chat',
      apiKey: CANARY,
    },
  },
  [FRIEND_SETTINGS_NAMESPACES.tts]: {
    provider: 'openai-compat',
    voice: 'alloy',
    openaiApiKey: CANARY,
    apiKey: CANARY,
    openai: { apiKey: CANARY, baseURL: 'http://127.0.0.1:9/v1', model: 'tts-1' },
    openaiBaseURL: 'http://127.0.0.1:9/v1',
    openaiModel: 'tts-1',
  },
  [FRIEND_SETTINGS_NAMESPACES.asr]: {
    engine: 'endpoint',
    openaiApiKey: CANARY,
    apiKey: CANARY,
    openai: { apiKey: CANARY, baseURL: 'http://127.0.0.1:9/v1' },
    openaiBaseURL: 'http://127.0.0.1:9/v1',
  },
  [FRIEND_SETTINGS_NAMESPACES.memory]: {
    distillHour: 4,
    summarizeModel: { baseURL: 'http://127.0.0.1:9/v1', model: 'sum', apiKey: CANARY },
  },
  [FRIEND_SETTINGS_NAMESPACES.growth]: {
    language: '中文',
    model: { baseURL: 'http://127.0.0.1:9/v1', model: 'grow', apiKey: CANARY },
  },
  [FRIEND_SETTINGS_NAMESPACES.stage]: {
    targetFps: 24,
    floatLeft: 16,
    floatTop: 32,
    floatWidth: 280,
    floatHeight: 360,
    openaiApiKey: CANARY,
  },
  [FRIEND_SETTINGS_NAMESPACES.reactions]: { enabled: true, level: 'voice' },
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
    for (const item of value) collectStringsAndKeys(item, out)
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
  expect(collectStringsAndKeys(value), `${label} deep walk`).not.toContain(CANARY)
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const field of FRIEND_SECRET_FIELDS) {
      expect(Object.hasOwn(value, field), `${label} own field ${field}`).toBe(false)
    }
  }
}

describe('config-center client projection never leaks secrets', () => {
  it('keeps the canary on the host documents and strips it from the aggregate snapshot', () => {
    expect(HOST_DOCUMENTS[FRIEND_SETTINGS_NAMESPACES.tts]).toMatchObject({ openaiApiKey: CANARY })
    const snapshot = projectDocuments(HOST_DOCUMENTS)
    expect(snapshot.tts.hasApiKey).toBe(true)
    expect(snapshot.asr.hasApiKey).toBe(true)
    expect(snapshot.tts.openaiBaseURL).toBe('http://127.0.0.1:9/v1')
    expect(snapshot.asr.openaiBaseURL).toBe('http://127.0.0.1:9/v1')
    expect(snapshot.memory.distillHour).toBe(4)
    expect(snapshot.stage.targetFps).toBe(24)
    expect(snapshot.stage.floatLeft).toBe(16)
    expect(snapshot.stage.floatTop).toBe(32)
    expect(snapshot.stage.floatWidth).toBe(280)
    expect(snapshot.stage.floatHeight).toBe(360)
    expect(snapshot.reactions.level).toBe('voice')
    expect((snapshot.persona.chatModel as { hasApiKey?: boolean }).hasApiKey).toBe(true)
    expect((snapshot.memory.summarizeModel as { hasApiKey?: boolean }).hasApiKey).toBe(true)
    expect((snapshot.growth.model as { hasApiKey?: boolean }).hasApiKey).toBe(true)
    assertNoCanary(snapshot, 'projectDocuments')
    assertNoCanary(snapshot.tts, 'tts')
    assertNoCanary(snapshot.asr, 'asr')
    assertNoCanary(snapshot.persona.chatModel, 'persona.chatModel')
    assertNoCanary(snapshot.memory.summarizeModel, 'memory.summarizeModel')
    assertNoCanary(snapshot.growth.model, 'growth.model')
  })

  it('uses the same boolean projection as the package-local TTS/ASR fallbacks', () => {
    const tts = defaultProjectTts(HOST_DOCUMENTS[FRIEND_SETTINGS_NAMESPACES.tts])
    const asr = defaultProjectAsr(HOST_DOCUMENTS[FRIEND_SETTINGS_NAMESPACES.asr])
    expect(tts.hasApiKey).toBe(true)
    expect(asr.hasApiKey).toBe(true)
    assertNoCanary(tts, 'defaultProjectTts')
    assertNoCanary(asr, 'defaultProjectAsr')
  })

  it('uses the official TTS/ASR sanitizers when seams are injected', () => {
    const seams = createOfficialSanitizeSeams()
    const snapshot = projectDocuments(HOST_DOCUMENTS, { seams })
    expect(snapshot.tts.hasApiKey).toBe(true)
    expect(snapshot.asr.hasApiKey).toBe(true)
    expect(snapshot.tts.openaiBaseURL).toBe('http://127.0.0.1:9/v1')
    expect(snapshot.asr.openaiBaseURL).toBe('http://127.0.0.1:9/v1')
    expect(snapshot.stage.floatWidth).toBe(280)
    assertNoCanary(snapshot, 'official seams projectDocuments')
    assertNoCanary(snapshot.tts, 'official tts')
    assertNoCanary(snapshot.asr, 'official asr')
    expect(seams.sanitizeTts).toBeTypeOf('function')
    expect(seams.sanitizeAsr).toBeTypeOf('function')
    assertNoCanary(seams.sanitizeTts?.(HOST_DOCUMENTS[FRIEND_SETTINGS_NAMESPACES.tts]), 'sanitizeTts')
    assertNoCanary(seams.sanitizeAsr?.(HOST_DOCUMENTS[FRIEND_SETTINGS_NAMESPACES.asr]), 'sanitizeAsr')
  })

  it('does not project a planted shell heartbeat document into the client snapshot', () => {
    const snapshot = projectDocuments({
      ...HOST_DOCUMENTS,
      'friend-shell': { version: CANARY, pid: 123, token: CANARY, platform: 'darwin' },
    })
    expect(snapshot).not.toHaveProperty('shell')
    expect(JSON.stringify(snapshot)).not.toContain('"pid"')
    assertNoCanary(snapshot, 'snapshot with fake shell heartbeat doc')
  })
})
