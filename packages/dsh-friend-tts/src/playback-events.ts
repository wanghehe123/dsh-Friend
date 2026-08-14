/**
 * Host → client `tts-ready` frames. Client-safe: no `node:`, no audio bytes,
 * no API keys. Shared `FriendPushEvent` already reserves `type: 'tts-ready'`
 * with `payload: unknown`; this file is the concrete payload contract.
 */

import { FRIEND_TTS_FALLBACK_ENGINE, FRIEND_TTS_FALLBACK_UI_HINT } from './providers/browser.ts'

export type FriendTtsReadySource = 'reply' | 'preview'

export type FriendTtsReadyAudioPayload = {
  kind: 'audio'
  id: string
  audioUrl: string
  mime: string
  providerId: string
  source: FriendTtsReadySource
  requestId: string
}

export type FriendTtsReadyFallbackPayload = {
  kind: 'browser-fallback'
  engine: typeof FRIEND_TTS_FALLBACK_ENGINE
  text: string
  voice?: string
  rate?: number
  pitch?: number
  uiHint: typeof FRIEND_TTS_FALLBACK_UI_HINT
  reason: string
  source: FriendTtsReadySource
  requestId: string
}

export type FriendTtsReadyPayload = FriendTtsReadyAudioPayload | FriendTtsReadyFallbackPayload

export type FriendTtsReadyEvent = {
  type: 'tts-ready'
  payload: FriendTtsReadyPayload
}

export type FriendTtsReadySink = {
  push(event: FriendTtsReadyEvent): void
  dispose?: () => void | Promise<void>
}

export function createTtsRequestId(): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj !== undefined && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }
  return `tts-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function isTtsReadyPayload(value: unknown): value is FriendTtsReadyPayload {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  if (typeof record.requestId !== 'string' || record.requestId.length === 0) {
    return false
  }
  if (record.source !== 'reply' && record.source !== 'preview') {
    return false
  }
  if (record.kind === 'audio') {
    return typeof record.id === 'string'
      && typeof record.audioUrl === 'string'
      && typeof record.mime === 'string'
      && typeof record.providerId === 'string'
  }
  if (record.kind === 'browser-fallback') {
    return record.engine === FRIEND_TTS_FALLBACK_ENGINE
      && record.uiHint === FRIEND_TTS_FALLBACK_UI_HINT
      && typeof record.text === 'string'
      && typeof record.reason === 'string'
  }
  return false
}

export function parseTtsReadyFrame(raw: string): FriendTtsReadyPayload | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') {
      return undefined
    }
    const record = parsed as { type?: unknown; payload?: unknown }
    const candidate = record.type === 'tts-ready' ? record.payload : parsed
    return isTtsReadyPayload(candidate) ? candidate : undefined
  } catch {
    return undefined
  }
}
