/**
 * Client-half browser TTS executor. Consumes {@link FriendTtsBrowserFallback}
 * and speaks via `speechSynthesis`. Public barge-in is the facade in
 * `stop-all.ts` (speechSynthesis + AudioContext together).
 */

import {
  createFriendTtsPlayer,
  type CreateFriendTtsPlayerOptions,
  type FriendTtsPlayer,
} from './audio-player.ts'
import { createFallbackLipsyncDriver } from './fallback-lipsync.ts'
import { dispatchFriendLipsync } from './lipsync.ts'
import {
  FRIEND_TTS_FALLBACK_UI_HINT,
  FRIEND_TTS_FALLBACK_UI_LABEL,
  fallbackUiLabel,
  type FriendTtsBrowserFallback,
} from './providers/browser.ts'
import {
  installFriendTtsStopAllGlobal,
  registerFriendTtsStop,
  stopAllFriendTts,
  type FriendTtsStopAll,
} from './stop-all.ts'

export type FriendTtsUiHint = typeof FRIEND_TTS_FALLBACK_UI_HINT

export interface SpeechSynthesisVoiceLike {
  voiceURI: string
  name: string
  lang: string
  localService: boolean
  default: boolean
}

export interface SpeechBoundaryEventLike {
  name?: string
  charIndex?: number
  charLength?: number
  elapsedTime?: number
  utterance: SpeechSynthesisUtteranceLike
}

export interface SpeechSynthesisUtteranceLike {
  text: string
  lang: string
  voice: SpeechSynthesisVoiceLike | null
  volume: number
  rate: number
  pitch: number
  onend: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  onboundary: ((event: SpeechBoundaryEventLike) => void) | null
}

export interface SpeechSynthesisLike {
  speaking: boolean
  pending: boolean
  paused: boolean
  getVoices(): SpeechSynthesisVoiceLike[]
  speak(utterance: SpeechSynthesisUtteranceLike): void
  cancel(): void
  pause(): void
  resume(): void
}

export type SpeechSynthesisUtteranceFactory = (text: string) => SpeechSynthesisUtteranceLike

export type SpeechFallbackSpeakRequest = Pick<FriendTtsBrowserFallback, 'text' | 'uiHint'> & {
  voice?: string
  rate?: number
  pitch?: number
}

export type { FriendTtsStopAll }

export type FriendTtsSpeechFallbackHandle = {
  speak(instruction: SpeechFallbackSpeakRequest): Promise<void>
  /** Speech-only stop. The public barge-in entry is {@link stopAllFriendTts}. */
  stopAll: FriendTtsStopAll
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  getVolume(): number
  isMuted(): boolean
  getUiHint(): FriendTtsUiHint | undefined
  getUiLabel(): string | undefined
  dispose(): void
}

export type FriendTtsClientRuntime = FriendTtsSpeechFallbackHandle & {
  player: FriendTtsPlayer
  /**
   * Companion-reply playback. No-ops when `autoSpeak` is off.
   * Explicit `speak()` (preview / barge-in-unrelated) is not gated.
   */
  speakReply(instruction: SpeechFallbackSpeakRequest): Promise<void>
  setAutoSpeak(enabled: boolean): void
  isAutoSpeak(): boolean
}

export type CreateSpeechFallbackExecutorOptions = {
  speechSynthesis?: SpeechSynthesisLike
  createUtterance?: SpeechSynthesisUtteranceFactory
  onUiHint?: (hint: FriendTtsUiHint | undefined) => void
  onBoundary?: (event: SpeechBoundaryEventLike) => void
  onSpeakStart?: (instruction: SpeechFallbackSpeakRequest) => void
  onSpeakEnd?: () => void
  player?: CreateFriendTtsPlayerOptions
  volume?: number
  muted?: boolean
  autoSpeak?: boolean
}

type QueuedSpeak = {
  instruction: SpeechFallbackSpeakRequest
  resolve: () => void
}

const RATE_MIN = 0.1
const RATE_MAX = 10
const PITCH_MIN = 0
const PITCH_MAX = 2

let active: FriendTtsClientRuntime | undefined

/** Last started client handle, if any. Safe no-op when none is mounted. */
export function getFriendTtsClient(): FriendTtsClientRuntime | undefined {
  return active
}

export { stopAllFriendTts }

export function createSpeechFallbackExecutor(
  options: CreateSpeechFallbackExecutorOptions = {},
): FriendTtsSpeechFallbackHandle {
  const synth = options.speechSynthesis ?? readGlobalSpeechSynthesis()
  const createUtterance = options.createUtterance ?? defaultUtteranceFactory()
  const queue: QueuedSpeak[] = []
  let current: QueuedSpeak | undefined
  let currentUtterance: SpeechSynthesisUtteranceLike | undefined
  let volume = clampSpeechVolume(options.volume ?? options.player?.volume ?? 1)
  let muted = options.muted === true || options.player?.muted === true
  let epoch = 0
  let uiHint: FriendTtsUiHint | undefined
  let disposed = false

  const playbackVolume = (): number => (muted ? 0 : volume)

  const applyUtteranceVolume = (): void => {
    if (currentUtterance !== undefined) {
      currentUtterance.volume = playbackVolume()
    }
  }

  const setHint = (next: FriendTtsUiHint | undefined): void => {
    uiHint = next
    options.onUiHint?.(next)
  }

  const finish = (item: QueuedSpeak, token: number): void => {
    if (token !== epoch) {
      return
    }
    if (current === item) {
      current = undefined
      currentUtterance = undefined
    }
    if (queue.length === 0) {
      setHint(undefined)
    }
    item.resolve()
    pump()
  }

  const pump = (): void => {
    if (disposed || synth === undefined) {
      return
    }
    if (synth.speaking || synth.pending) {
      return
    }
    const item = queue.shift()
    if (item === undefined) {
      return
    }
    current = item
    const token = epoch
    if (item.instruction.uiHint === FRIEND_TTS_FALLBACK_UI_HINT) {
      setHint(FRIEND_TTS_FALLBACK_UI_HINT)
    }
    const utterance = mapUtterance(createUtterance, item.instruction, synth, playbackVolume())
    currentUtterance = utterance
    options.onSpeakStart?.(item.instruction)
    utterance.onend = () => {
      options.onSpeakEnd?.()
      finish(item, token)
    }
    utterance.onerror = () => {
      options.onSpeakEnd?.()
      finish(item, token)
    }
    utterance.onboundary = (event) => {
      if (token !== epoch) {
        return
      }
      options.onBoundary?.(event)
    }
    synth.speak(utterance)
  }

  const handle: FriendTtsSpeechFallbackHandle = {
    speak(instruction) {
      if (disposed) {
        return Promise.resolve()
      }
      if (synth === undefined) {
        return Promise.resolve()
      }
      return new Promise((resolve) => {
        queue.push({ instruction, resolve })
        pump()
      })
    },

    stopAll() {
      epoch += 1
      const waiting = queue.splice(0, queue.length)
      if (current !== undefined) {
        waiting.unshift(current)
        current = undefined
      }
      currentUtterance = undefined
      setHint(undefined)
      options.onSpeakEnd?.()
      synth?.cancel()
      for (const item of waiting) {
        item.resolve()
      }
    },

    setVolume(next) {
      volume = clampSpeechVolume(next)
      applyUtteranceVolume()
    },

    setMuted(next) {
      muted = next
      applyUtteranceVolume()
    },

    getVolume() {
      return volume
    },

    isMuted() {
      return muted
    },

    getUiHint() {
      return uiHint
    },

    getUiLabel() {
      return uiHint === FRIEND_TTS_FALLBACK_UI_HINT ? FRIEND_TTS_FALLBACK_UI_LABEL : undefined
    },

    dispose() {
      disposed = true
      handle.stopAll()
      if (active === handle) {
        active = undefined
      }
    },
  }

  return handle
}

export function startTtsClient(options: CreateSpeechFallbackExecutorOptions = {}): FriendTtsClientRuntime {
  active?.dispose()
  const initialVolume = options.volume ?? options.player?.volume ?? 1
  const initialMuted = options.muted === true || options.player?.muted === true
  let autoSpeak = options.autoSpeak !== false
  const fallbackLipsync = createFallbackLipsyncDriver()
  const userBoundary = options.onBoundary
  const userSpeakStart = options.onSpeakStart
  const userSpeakEnd = options.onSpeakEnd
  const userEnergy = options.player?.onEnergy
  const speech = createSpeechFallbackExecutor({
    ...options,
    volume: initialVolume,
    muted: initialMuted,
    onSpeakStart(instruction) {
      fallbackLipsync.start(instruction.text, instruction.rate)
      userSpeakStart?.(instruction)
    },
    onSpeakEnd() {
      fallbackLipsync.stop()
      userSpeakEnd?.()
    },
    onBoundary(event) {
      fallbackLipsync.onBoundary()
      userBoundary?.(event)
    },
  })
  const player = createFriendTtsPlayer({
    ...(options.player ?? {}),
    volume: initialVolume,
    muted: initialMuted,
    onEnergy(sample) {
      dispatchFriendLipsync(sample.rms)
      userEnergy?.(sample)
    },
  })
  const unregisterSpeech = registerFriendTtsStop(() => {
    speech.stopAll()
  })
  const unregisterPlayer = registerFriendTtsStop(() => {
    player.stopAll()
  })
  const uninstallGlobal = installFriendTtsStopAllGlobal()

  const handle: FriendTtsClientRuntime = {
    speak: (instruction) => speech.speak(instruction),
    speakReply(instruction) {
      if (!autoSpeak) {
        return Promise.resolve()
      }
      return speech.speak(instruction)
    },
    stopAll: stopAllFriendTts,
    player,
    setVolume(next) {
      speech.setVolume(next)
      player.setVolume(next)
    },
    setMuted(next) {
      speech.setMuted(next)
      player.setMuted(next)
    },
    getVolume: () => speech.getVolume(),
    isMuted: () => speech.isMuted(),
    setAutoSpeak(enabled) {
      autoSpeak = enabled
    },
    isAutoSpeak() {
      return autoSpeak
    },
    getUiHint: () => speech.getUiHint(),
    getUiLabel: () => speech.getUiLabel(),
    dispose() {
      unregisterSpeech()
      unregisterPlayer()
      uninstallGlobal()
      player.dispose()
      speech.dispose()
      if (active === handle) {
        active = undefined
      }
    },
  }
  active = handle
  return handle
}

export { FRIEND_TTS_FALLBACK_UI_HINT, FRIEND_TTS_FALLBACK_UI_LABEL, fallbackUiLabel }

export function mapRateToSpeech(rate: number | undefined): number {
  if (rate === undefined || !Number.isFinite(rate)) {
    return 1
  }
  return Math.min(RATE_MAX, Math.max(RATE_MIN, rate))
}

export function mapPitchToSpeech(pitch: number | undefined): number {
  if (pitch === undefined || !Number.isFinite(pitch)) {
    return 1
  }
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch))
}

export function pickSpeechVoice(
  voices: readonly SpeechSynthesisVoiceLike[],
  wanted: string | undefined,
): SpeechSynthesisVoiceLike | undefined {
  if (wanted === undefined || wanted.trim().length === 0) {
    return voices.find((voice) => voice.default) ?? voices[0]
  }
  const needle = wanted.trim().toLowerCase()
  return voices.find((voice) => voice.voiceURI.toLowerCase() === needle)
    ?? voices.find((voice) => voice.name.toLowerCase() === needle)
    ?? voices.find((voice) => voice.name.toLowerCase().includes(needle))
    ?? voices.find((voice) => voice.lang.toLowerCase() === needle)
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith(needle))
}

function mapUtterance(
  createUtterance: SpeechSynthesisUtteranceFactory,
  instruction: SpeechFallbackSpeakRequest,
  synth: SpeechSynthesisLike,
  volume: number,
): SpeechSynthesisUtteranceLike {
  const utterance = createUtterance(instruction.text)
  utterance.text = instruction.text
  utterance.rate = mapRateToSpeech(instruction.rate)
  utterance.pitch = mapPitchToSpeech(instruction.pitch)
  utterance.volume = clampSpeechVolume(volume)
  const voice = pickSpeechVoice(synth.getVoices(), instruction.voice)
  if (voice !== undefined) {
    utterance.voice = voice
    utterance.lang = voice.lang
  }
  return utterance
}

function clampSpeechVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 1
  }
  return Math.min(1, Math.max(0, value))
}

function readGlobalSpeechSynthesis(): SpeechSynthesisLike | undefined {
  const value = (globalThis as { speechSynthesis?: SpeechSynthesisLike }).speechSynthesis
  return value
}

function defaultUtteranceFactory(): SpeechSynthesisUtteranceFactory {
  const Ctor = (globalThis as {
    SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtteranceLike
  }).SpeechSynthesisUtterance
  if (Ctor !== undefined) {
    return (text) => new Ctor(text)
  }
  return (text) => createPlainUtterance(text)
}

export function createPlainUtterance(text: string): SpeechSynthesisUtteranceLike {
  return {
    text,
    lang: '',
    voice: null,
    volume: 1,
    rate: 1,
    pitch: 1,
    onend: null,
    onerror: null,
    onboundary: null,
  }
}
