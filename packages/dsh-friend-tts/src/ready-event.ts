/**
 * Host-only projection: a speak result becomes a client-safe `tts-ready`
 * frame. Audio bytes and provider error lists stay on the host.
 */

import { isBrowserFallback } from './providers/browser.ts'
import {
  createTtsRequestId,
  type FriendTtsReadyEvent,
  type FriendTtsReadyFallbackPayload,
  type FriendTtsReadySource,
} from './playback-events.ts'
import type { FriendTtsSpeakResult } from './service.ts'

export function toTtsReadyEvent(
  result: FriendTtsSpeakResult,
  source: FriendTtsReadySource,
  requestId: string = createTtsRequestId(),
): FriendTtsReadyEvent {
  if (isBrowserFallback(result)) {
    const payload: FriendTtsReadyFallbackPayload = {
      kind: 'browser-fallback',
      engine: result.engine,
      text: result.text,
      uiHint: result.uiHint,
      reason: result.reason,
      source,
      requestId,
    }
    if (result.voice !== undefined) payload.voice = result.voice
    if (result.rate !== undefined) payload.rate = result.rate
    if (result.pitch !== undefined) payload.pitch = result.pitch
    return { type: 'tts-ready', payload }
  }
  return {
    type: 'tts-ready',
    payload: {
      kind: 'audio',
      id: result.id,
      audioUrl: result.audioUrl,
      mime: result.mime,
      providerId: result.providerId,
      source,
      requestId,
    },
  }
}
