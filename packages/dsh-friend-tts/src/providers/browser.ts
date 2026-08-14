/**
 * Host-side browser fallback: never synthesizes audio. The router returns
 * this instruction; the client half (`speech-fallback.ts`) speaks it via
 * `speechSynthesis`. `uiHint: 'fallback'` is the「兜底中」marker.
 */

import type { FriendTtsSynthesizeOpts } from '../seam.ts'

export const FRIEND_TTS_FALLBACK_ENGINE = 'speechSynthesis' as const
export const FRIEND_TTS_FALLBACK_UI_HINT = 'fallback' as const
export const FRIEND_TTS_FALLBACK_UI_LABEL = '兜底中'

export interface FriendTtsFailedProvider {
  id: string
  error: string
}

export interface FriendTtsBrowserFallback {
  kind: 'browser-fallback'
  engine: typeof FRIEND_TTS_FALLBACK_ENGINE
  text: string
  voice?: string
  rate?: number
  pitch?: number
  uiHint: typeof FRIEND_TTS_FALLBACK_UI_HINT
  reason: string
  failedProviders: readonly FriendTtsFailedProvider[]
}

export function createBrowserFallbackInstruction(
  text: string,
  opts: Pick<FriendTtsSynthesizeOpts, 'voice' | 'rate' | 'pitch'>,
  reason: string,
  failedProviders: readonly FriendTtsFailedProvider[] = [],
): FriendTtsBrowserFallback {
  return {
    kind: 'browser-fallback',
    engine: FRIEND_TTS_FALLBACK_ENGINE,
    text,
    ...(opts.voice !== undefined ? { voice: opts.voice } : {}),
    ...(opts.rate !== undefined ? { rate: opts.rate } : {}),
    ...(opts.pitch !== undefined ? { pitch: opts.pitch } : {}),
    uiHint: FRIEND_TTS_FALLBACK_UI_HINT,
    reason,
    failedProviders,
  }
}

/** UI copy for a fallback instruction. `undefined` when not in兜底. */
export function fallbackUiLabel(instruction: { uiHint?: string } | undefined): string | undefined {
  return instruction?.uiHint === FRIEND_TTS_FALLBACK_UI_HINT
    ? FRIEND_TTS_FALLBACK_UI_LABEL
    : undefined
}

export function isBrowserFallback(value: unknown): value is FriendTtsBrowserFallback {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return record.kind === 'browser-fallback'
    && record.engine === FRIEND_TTS_FALLBACK_ENGINE
    && record.uiHint === FRIEND_TTS_FALLBACK_UI_HINT
    && typeof record.text === 'string'
}
