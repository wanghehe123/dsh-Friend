/**
 * Speak path: cache lookup → in-flight dedupe → session-ordered queue → router.
 * Browser-fallback results are not cached (no bytes).
 */

import {
  buildTtsCacheKey,
  type FriendTtsCache,
  type FriendTtsCacheKeyInput,
  type FriendTtsCachedAudio,
} from './cache.ts'
import { FRIEND_TTS_AUDIO_PATH } from './paths.ts'
import { prepareTtsText, type PreparedTtsText } from './prepare.ts'
import { createBrowserFallbackInstruction } from './providers/browser.ts'
import type { FriendTtsQueue } from './queue.ts'
import type {
  FriendTtsAudioResult,
  FriendTtsBrowserFallback,
  FriendTtsLog,
  FriendTtsRouter,
} from './router.ts'
import type { FriendTtsSynthesizeOpts } from './seam.ts'

export type FriendTtsSpeakOpts = FriendTtsSynthesizeOpts & {
  sessionId?: string
  /** Skip prepare (already-clean text). */
  raw?: boolean
  stripStageDirections?: boolean
  /**
   * Per-call override for the companion-reply gate.
   * `speakReply` (and `speak`, which delegates to it) skip synthesis when this
   * resolves false. Preview / explicit callers pass `true`.
   */
  autoSpeak?: boolean
}

export type FriendTtsSpeakAudio = FriendTtsAudioResult & {
  id: string
  audioUrl: string
  cacheHit: boolean
}

export type FriendTtsSpeakResult = FriendTtsSpeakAudio | FriendTtsBrowserFallback

export type FriendTtsSpeakBatch = {
  first: FriendTtsSpeakResult | undefined
  firstReadyMs: number
  sentences: readonly string[]
  rest: Promise<FriendTtsSpeakResult[]>
}

export type FriendTtsService = {
  speak(text: string, opts?: FriendTtsSpeakOpts): Promise<FriendTtsSpeakResult>
  speakReply(text: string, opts?: FriendTtsSpeakOpts): Promise<FriendTtsSpeakBatch>
  prepare(text: string, opts?: FriendTtsSpeakOpts): PreparedTtsText
  getAudio(id: string): Promise<FriendTtsCachedAudio | undefined>
}

export type CreateFriendTtsServiceOptions = {
  router: FriendTtsRouter
  cache: FriendTtsCache
  queue: FriendTtsQueue
  getPreferredProvider: () => string
  getStripStageDirections?: () => boolean
  /** Live `autoSpeak`. Default on. Read on every `speakReply` / `speak`. */
  getAutoSpeak?: () => boolean
  log?: FriendTtsLog
  now?: () => number
}

export function createFriendTtsService(options: CreateFriendTtsServiceOptions): FriendTtsService {
  const log = options.log
  const now = options.now ?? Date.now
  const inflight = new Map<string, Promise<FriendTtsSpeakResult>>()

  const resolveStrip = (opts?: FriendTtsSpeakOpts): boolean => {
    if (opts?.stripStageDirections !== undefined) {
      return opts.stripStageDirections
    }
    try {
      return options.getStripStageDirections?.() !== false
    } catch {
      return true
    }
  }

  const resolveAutoSpeak = (opts?: FriendTtsSpeakOpts): boolean => {
    if (opts?.autoSpeak !== undefined) {
      return opts.autoSpeak
    }
    try {
      return options.getAutoSpeak?.() !== false
    } catch {
      return true
    }
  }

  const prepare = (text: string, opts?: FriendTtsSpeakOpts): PreparedTtsText => {
    if (opts?.raw === true) {
      return { speakable: text, sentences: text.trim().length > 0 ? [text] : [], displayText: text }
    }
    return prepareTtsText(text, { stripStageDirections: resolveStrip(opts) })
  }

  const speakOne = async (text: string, opts?: FriendTtsSpeakOpts): Promise<FriendTtsSpeakResult> => {
    const keyInput = keyInputOf(text, opts, options.getPreferredProvider())
    const id = buildTtsCacheKey(keyInput)
    const cached = await options.cache.get(id)
    if (cached !== undefined) {
      log?.(`dsh-friend-tts: cache hit ${id}`)
      return toSpeakAudio(cached, true)
    }

    const existing = inflight.get(id)
    if (existing !== undefined) {
      log?.(`dsh-friend-tts: coalesce ${id}`)
      return existing
    }

    const job = options.queue.enqueue(async () => {
      const again = await options.cache.get(id)
      if (again !== undefined) {
        log?.(`dsh-friend-tts: cache hit ${id}`)
        return toSpeakAudio(again, true)
      }
      const routed = await options.router.synthesize(text, opts)
      if (routed.kind === 'browser-fallback') {
        return routed
      }
      const stored = await options.cache.set(keyInput, {
        providerId: routed.providerId,
        mime: routed.mime,
        audio: routed.audio,
      })
      return toSpeakAudio(stored, false)
    }, opts?.sessionId !== undefined ? { sessionId: opts.sessionId } : {})

    inflight.set(id, job)
    try {
      return await job
    } finally {
      inflight.delete(id)
    }
  }

  const speakReply = async (text: string, opts?: FriendTtsSpeakOpts): Promise<FriendTtsSpeakBatch> => {
    const started = now()
    const prepared = prepare(text, opts)
    if (!resolveAutoSpeak(opts)) {
      return { first: undefined, firstReadyMs: now() - started, sentences: prepared.sentences, rest: Promise.resolve([]) }
    }
    if (prepared.sentences.length === 0) {
      return { first: undefined, firstReadyMs: now() - started, sentences: [], rest: Promise.resolve([]) }
    }
    const [head, ...tail] = prepared.sentences
    if (head === undefined) {
      return { first: undefined, firstReadyMs: now() - started, sentences: [], rest: Promise.resolve([]) }
    }
    const firstJob = speakOne(head, opts)
    const restJob = Promise.all(tail.map((sentence) => speakOne(sentence, opts)))
    const first = await firstJob
    return {
      first,
      firstReadyMs: now() - started,
      sentences: prepared.sentences,
      rest: restJob,
    }
  }

  const speak = async (text: string, opts?: FriendTtsSpeakOpts): Promise<FriendTtsSpeakResult> => {
    const batch = await speakReply(text, opts)
    if (batch.first !== undefined) {
      return batch.first
    }
    return createBrowserFallbackInstruction('', {}, 'empty after prepare')
  }

  return {
    speak,
    speakReply,
    prepare,
    getAudio(id) {
      return options.cache.get(id)
    },
  }
}

export function ttsAudioUrl(id: string): string {
  return `${FRIEND_TTS_AUDIO_PATH}/${id}`
}

function keyInputOf(
  text: string,
  opts: FriendTtsSpeakOpts | undefined,
  preferredProvider: string,
): FriendTtsCacheKeyInput {
  const provider = opts?.provider?.trim() || preferredProvider
  const input: FriendTtsCacheKeyInput = { provider, text }
  if (opts?.voice !== undefined) input.voice = opts.voice
  if (opts?.rate !== undefined) input.rate = opts.rate
  if (opts?.pitch !== undefined) input.pitch = opts.pitch
  if (opts?.format !== undefined) input.format = opts.format
  if (opts?.model !== undefined) input.model = opts.model
  return input
}

function toSpeakAudio(entry: FriendTtsCachedAudio, cacheHit: boolean): FriendTtsSpeakAudio {
  return {
    kind: 'audio',
    providerId: entry.providerId,
    audio: entry.audio,
    mime: entry.mime,
    id: entry.id,
    audioUrl: ttsAudioUrl(entry.id),
    cacheHit,
  }
}
