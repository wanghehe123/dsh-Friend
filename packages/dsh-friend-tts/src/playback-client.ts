/**
 * Client consumer for host `tts-ready` frames: fetch cached audio or run
 * `speechSynthesis`, then the player / fallback executor drive lipsync.
 */

import { FRIEND_TTS_EVENTS_PATH, FRIEND_TTS_PREVIEW_PATH } from './paths.ts'
import {
  parseTtsReadyFrame,
  type FriendTtsReadyPayload,
} from './playback-events.ts'
import { FRIEND_TTS_PREVIEW_SENTENCE } from './preview-sentence.ts'
import type { FriendTtsClientRuntime } from './speech-fallback.ts'

export type TtsEventSourceLike = {
  addEventListener(type: string, listener: (event: { data: string }) => void): void
  close(): void
}

export type TtsEventSourceCtor = new (url: string) => TtsEventSourceLike

export type TtsFetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
  arrayBuffer(): Promise<ArrayBuffer>
}>

export type FriendTtsPlaybackHandle = FriendTtsClientRuntime & {
  playReady(payload: FriendTtsReadyPayload): Promise<void>
  preview(text?: string): Promise<FriendTtsReadyPayload | undefined>
}

export type AttachTtsPlaybackOptions = {
  EventSource?: TtsEventSourceCtor
  fetch?: TtsFetchLike
  eventsUrl?: string
  previewUrl?: string
}

const SEEN_CAP = 32

export function attachTtsPlayback(
  handle: FriendTtsClientRuntime,
  options: AttachTtsPlaybackOptions = {},
): FriendTtsPlaybackHandle {
  const seen = new Set<string>()
  const fetchImpl = options.fetch ?? globalThis.fetch
  const previewUrl = options.previewUrl ?? FRIEND_TTS_PREVIEW_PATH
  const eventsUrl = options.eventsUrl ?? FRIEND_TTS_EVENTS_PATH

  const remember = (requestId: string): boolean => {
    if (seen.has(requestId)) {
      return false
    }
    seen.add(requestId)
    if (seen.size > SEEN_CAP) {
      const first = seen.values().next().value
      if (first !== undefined) {
        seen.delete(first)
      }
    }
    return true
  }

  const playReady = async (payload: FriendTtsReadyPayload): Promise<void> => {
    if (!remember(payload.requestId)) {
      return
    }
    if (payload.source === 'reply' && !handle.isAutoSpeak()) {
      return
    }
    if (payload.kind === 'browser-fallback') {
      const speak = payload.source === 'preview' ? handle.speak : handle.speakReply
      await speak({
        text: payload.text,
        uiHint: payload.uiHint,
        ...(payload.voice !== undefined ? { voice: payload.voice } : {}),
        ...(payload.rate !== undefined ? { rate: payload.rate } : {}),
        ...(payload.pitch !== undefined ? { pitch: payload.pitch } : {}),
      })
      return
    }
    if (typeof fetchImpl !== 'function') {
      return
    }
    const response = await fetchImpl(payload.audioUrl)
    if (!response.ok) {
      return
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    await handle.player.enqueue({
      id: payload.id,
      bytes,
      mime: payload.mime,
    })
  }

  const preview = async (text?: string): Promise<FriendTtsReadyPayload | undefined> => {
    if (typeof fetchImpl !== 'function') {
      return undefined
    }
    const response = await fetchImpl(previewUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text ?? FRIEND_TTS_PREVIEW_SENTENCE }),
    })
    if (!response.ok) {
      return undefined
    }
    const parsed: unknown = await response.json()
    if (!isReadyPayload(parsed)) {
      return undefined
    }
    void playReady(parsed)
    return parsed
  }

  const Source = options.EventSource ?? globalThis.EventSource
  let source: TtsEventSourceLike | undefined
  if (typeof Source === 'function') {
    try {
      source = new Source(eventsUrl)
      const onReady = (event: { data: string }): void => {
        const payload = parseTtsReadyFrame(event.data)
        if (payload === undefined) {
          return
        }
        void playReady(payload)
      }
      source.addEventListener('tts-ready', onReady)
    } catch {
      source = undefined
    }
  }

  const innerDispose = handle.dispose.bind(handle)
  const playback: FriendTtsPlaybackHandle = {
    ...handle,
    playReady,
    preview,
    dispose() {
      try {
        source?.close()
      } catch {
        // already closed
      }
      innerDispose()
    },
  }
  playback.speak = handle.speak.bind(handle)
  playback.speakReply = handle.speakReply.bind(handle)
  playback.stopAll = handle.stopAll
  playback.setVolume = handle.setVolume.bind(handle)
  playback.setMuted = handle.setMuted.bind(handle)
  playback.getVolume = handle.getVolume.bind(handle)
  playback.isMuted = handle.isMuted.bind(handle)
  playback.setAutoSpeak = handle.setAutoSpeak.bind(handle)
  playback.isAutoSpeak = handle.isAutoSpeak.bind(handle)
  playback.getUiHint = handle.getUiHint.bind(handle)
  playback.getUiLabel = handle.getUiLabel.bind(handle)
  return playback
}

function isReadyPayload(value: unknown): value is FriendTtsReadyPayload {
  return parseTtsReadyFrame(JSON.stringify({ type: 'tts-ready', payload: value })) !== undefined
}
