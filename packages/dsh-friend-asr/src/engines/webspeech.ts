import type {
  AsrEngine,
  AsrEngineCapabilities,
  AsrErrorHandler,
  AsrListenMode,
  AsrTranscriptHandler,
  AsrUnavailableCode,
} from '../engine.ts'
import { stripReplayPrefix } from '../replay-prefix.ts'

/** Minimal SpeechRecognition surface. Injected in tests; browser global in prod. */
export interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null
  onerror: ((event: { error?: string; message?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

export interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike
}

export interface SpeechRecognitionAlternativeLike {
  transcript: string
}

export interface SpeechRecognitionResultLike {
  isFinal: boolean
  length: number
  0?: SpeechRecognitionAlternativeLike
  item?(index: number): SpeechRecognitionAlternativeLike
}

export interface SpeechRecognitionResultEventLike {
  resultIndex?: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

export type WebSpeechGlobals = {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
  navigator?: { userAgent?: string }
}

export type WebSpeechEngineOptions = {
  globals?: WebSpeechGlobals
  getLang?: () => string
  lang?: string
}

export const WEBSPEECH_ENGINE_ID = 'webspeech' as const
export const WEBSPEECH_DEFAULT_LANG = 'zh-CN'

function resolveGlobals(explicit: WebSpeechGlobals | undefined): WebSpeechGlobals {
  if (explicit !== undefined) {
    return explicit
  }
  return globalThis as WebSpeechGlobals
}

function userAgentOf(globals: WebSpeechGlobals): string {
  const fromNavigator = globals.navigator?.userAgent
  if (typeof fromNavigator === 'string') {
    return fromNavigator
  }
  if (typeof globalThis.navigator === 'object' && globalThis.navigator !== null) {
    return globalThis.navigator.userAgent
  }
  return ''
}

/**
 * Non-Chromium Safari (WebKit). Chrome/Edge/Firefox on iOS identify themselves
 * separately; those still fail the constructor check when SpeechRecognition is
 * missing.
 */
export function isNonChromiumSafari(userAgent: string): boolean {
  return /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|FxiOS|Android/i.test(userAgent)
}

/** Tauri / friend-shell WebView. */
export function isDesktopShellUserAgent(userAgent: string): boolean {
  return /Tauri|dsh-friend-shell|FriendShell/i.test(userAgent)
}

function ctorOf(globals: WebSpeechGlobals): SpeechRecognitionConstructor | undefined {
  return globals.SpeechRecognition ?? globals.webkitSpeechRecognition
}

function diagnose(
  globals: WebSpeechGlobals,
): { available: true } | { available: false; reason: string; reasonCode: AsrUnavailableCode } {
  const ua = userAgentOf(globals)
  if (isDesktopShellUserAgent(ua)) {
    return {
      available: false,
      reasonCode: 'desktop-shell',
      reason: '当前桌面壳 WebView 不提供 Web Speech，请改用自定义 endpoint 引擎',
    }
  }
  if (isNonChromiumSafari(ua)) {
    return {
      available: false,
      reasonCode: 'safari',
      reason: 'Safari 不支持稳定的 Web Speech，请改用自定义 endpoint 引擎',
    }
  }
  if (ctorOf(globals) === undefined) {
    return {
      available: false,
      reasonCode: 'missing-speech-recognition',
      reason: '当前环境没有 SpeechRecognition（WebView 或未授权的浏览器）',
    }
  }
  return { available: true }
}

function transcriptOf(result: SpeechRecognitionResultLike): string {
  const first = result[0] ?? result.item?.(0)
  return first?.transcript ?? ''
}

export type SeenSpeechResult = {
  isFinal: boolean
  text: string
}

/**
 * Walk a SpeechRecognition `onresult` payload.
 *
 * Chrome keeps a cumulative `results` list and sometimes reports
 * `resultIndex = 0` (or omits it) on later events. Each new final is
 * emitted on its own so a replayed segment is not glued onto the next.
 * `seen` skips an index that already dispatched that same final. The
 * same index may still move interim → final.
 */
export function emitFromResultEvent(
  event: SpeechRecognitionResultEventLike,
  onPartial: AsrTranscriptHandler | undefined,
  onFinal: AsrTranscriptHandler | undefined,
  seen?: Map<number, SeenSpeechResult>,
): void {
  const results = event.results
  const start = event.resultIndex ?? 0
  let interim = ''
  let replayedFinal = false
  let emittedFinal = false
  for (let index = start; index < results.length; index += 1) {
    const result = results[index]
    if (result === undefined) {
      continue
    }
    const text = transcriptOf(result)
    if (text.length === 0) {
      continue
    }
    if (result.isFinal) {
      const previous = seen?.get(index)
      if (previous?.isFinal === true && previous.text === text) {
        replayedFinal = true
        continue
      }
      seen?.set(index, { isFinal: true, text })
      const finalText = previous?.isFinal === true
        ? stripReplayPrefix(text, previous.text)
        : text
      if (finalText.length > 0) {
        emittedFinal = true
        onFinal?.(finalText)
      } else if (previous?.isFinal === true) {
        // Whitespace-only changes are still a replay after normalization.
        replayedFinal = true
      }
    } else {
      // A finalized index cannot become interim again within one recognition
      // session. Ignore that browser replay and clear any stale draft below.
      if (seen?.get(index)?.isFinal === true) {
        replayedFinal = true
        continue
      }
      interim += text
    }
  }
  if (interim.length > 0) {
    onPartial?.(interim)
  } else if (replayedFinal && !emittedFinal) {
    // A browser replay can arrive after a fresh interim. Clear that interim so
    // auto mode cannot send it later as a standalone fragment.
    onPartial?.('')
  }
}

const RETRYABLE_SPEECH_ERRORS = new Set(['not-allowed', 'audio-capture', 'network'])

function isContinuousMode(mode: AsrListenMode): boolean {
  return mode === 'auto' || mode === 'toggle'
}

function isRetryableSpeechError(reason: string): boolean {
  return RETRYABLE_SPEECH_ERRORS.has(reason)
}

export function inspectWebSpeechCapabilities(globals?: WebSpeechGlobals): AsrEngineCapabilities {
  const resolved = resolveGlobals(globals)
  const diagnosis = diagnose(resolved)
  if (!diagnosis.available) {
    return {
      available: false,
      engineId: WEBSPEECH_ENGINE_ID,
      reason: diagnosis.reason,
      reasonCode: diagnosis.reasonCode,
      interimResults: false,
      continuous: false,
    }
  }
  return {
    available: true,
    engineId: WEBSPEECH_ENGINE_ID,
    interimResults: true,
    continuous: true,
  }
}

/**
 * Browser `SpeechRecognition` engine. Never throws on unsupported environments:
 * `capabilities().available === false` and `start()` is a no-op that reports
 * via `onError`.
 */
export function createWebSpeechEngine(options: WebSpeechEngineOptions = {}): AsrEngine {
  const globals = resolveGlobals(options.globals)
  const getLang = (): string => {
    if (options.getLang !== undefined) {
      const live = options.getLang()
      if (live.length > 0) {
        return live
      }
    }
    return options.lang ?? WEBSPEECH_DEFAULT_LANG
  }

  let onPartial: AsrTranscriptHandler | undefined
  let onFinal: AsrTranscriptHandler | undefined
  let onError: AsrErrorHandler | undefined
  let recognition: SpeechRecognitionLike | undefined
  let wanted = false
  let activeMode: AsrListenMode = 'hold'
  let gestureUnbind: (() => void) | undefined

  const capabilities = (): AsrEngineCapabilities => inspectWebSpeechCapabilities(globals)

  const disposeRecognition = (abort: boolean): void => {
    const current = recognition
    recognition = undefined
    if (current === undefined) {
      return
    }
    current.onresult = null
    current.onerror = null
    current.onend = null
    try {
      if (abort) {
        current.abort()
      } else {
        current.stop()
      }
    } catch {
      // stop/abort can throw InvalidStateError if already stopped
    }
  }

  const attach = (instance: SpeechRecognitionLike, mode: AsrListenMode): void => {
    instance.interimResults = true
    instance.continuous = mode === 'auto' || mode === 'toggle'
    instance.lang = getLang()
    const seen = new Map<number, SeenSpeechResult>()
    instance.onresult = (event) => {
      emitFromResultEvent(
        event,
        onPartial,
        onFinal,
        seen,
      )
    }
    instance.onerror = (event) => {
      const reason = event.error ?? event.message ?? 'speech-recognition-error'
      if (reason === 'no-speech' || reason === 'aborted') {
        return
      }
      if (wanted && isContinuousMode(activeMode) && isRetryableSpeechError(reason)) {
        armGestureRestart()
        return
      }
      onError?.(reason)
    }
    instance.onend = () => {
      if (!wanted) {
        return
      }
      if (activeMode !== 'auto' && activeMode !== 'toggle') {
        return
      }
      // SpeechRecognition result indexes are scoped to one recognition
      // session. A restarted session may legitimately reuse index 0 and text.
      seen.clear()
      try {
        instance.start()
      } catch {
        armGestureRestart()
      }
    }
  }

  const startInstance = (mode: AsrListenMode): void => {
    const Ctor = ctorOf(globals)
    const diagnosis = diagnose(globals)
    if (!diagnosis.available || Ctor === undefined) {
      onError?.(diagnosis.available ? 'missing-speech-recognition' : diagnosis.reason)
      return
    }
    disposeRecognition(true)
    wanted = true
    activeMode = mode
    const instance = new Ctor()
    recognition = instance
    attach(instance, mode)
    try {
      instance.start()
    } catch (error) {
      recognition = undefined
      if (wanted && isContinuousMode(mode)) {
        armGestureRestart()
        return
      }
      wanted = false
      const message = error instanceof Error ? error.message : 'speech-recognition-start-failed'
      onError?.(message)
    }
  }

  const clearGestureRestart = (): void => {
    gestureUnbind?.()
    gestureUnbind = undefined
  }

  const armGestureRestart = (): void => {
    if (gestureUnbind !== undefined) {
      return
    }
    const target = globalThis as {
      addEventListener?: (type: string, listener: () => void, options?: boolean) => void
      removeEventListener?: (type: string, listener: () => void, options?: boolean) => void
    }
    const onGesture = (): void => {
      clearGestureRestart()
      if (wanted) {
        startInstance(activeMode)
      }
    }
    target.addEventListener?.('pointerdown', onGesture, true)
    target.addEventListener?.('keydown', onGesture, true)
    gestureUnbind = () => {
      target.removeEventListener?.('pointerdown', onGesture, true)
      target.removeEventListener?.('keydown', onGesture, true)
    }
  }

  return {
    get onPartial() {
      return onPartial
    },
    set onPartial(handler) {
      onPartial = handler
    },
    get onFinal() {
      return onFinal
    },
    set onFinal(handler) {
      onFinal = handler
    },
    get onError() {
      return onError
    },
    set onError(handler) {
      onError = handler
    },
    start(mode) {
      startInstance(mode)
    },
    stop() {
      wanted = false
      clearGestureRestart()
      disposeRecognition(false)
    },
    capabilities,
  }
}
