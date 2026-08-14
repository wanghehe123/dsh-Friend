import type {
  AsrEngine,
  AsrEngineCapabilities,
  AsrErrorHandler,
  AsrListenMode,
  AsrTranscriptHandler,
  AsrUnavailableCode,
} from '../engine.ts'

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

function emitFromResultEvent(
  event: SpeechRecognitionResultEventLike,
  onPartial: AsrTranscriptHandler | undefined,
  onFinal: AsrTranscriptHandler | undefined,
): void {
  const results = event.results
  const start = event.resultIndex ?? 0
  let interim = ''
  let finals = ''
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
      finals += text
    } else {
      interim += text
    }
  }
  if (finals.length > 0) {
    onFinal?.(finals)
  }
  if (interim.length > 0) {
    onPartial?.(interim)
  }
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
    instance.onresult = (event) => {
      emitFromResultEvent(event, onPartial, onFinal)
    }
    instance.onerror = (event) => {
      const reason = event.error ?? event.message ?? 'speech-recognition-error'
      if (reason === 'no-speech' || reason === 'aborted') {
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
      try {
        instance.start()
      } catch {
        onError?.('speech-recognition-restart-failed')
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
      wanted = false
      recognition = undefined
      const message = error instanceof Error ? error.message : 'speech-recognition-start-failed'
      onError?.(message)
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
      disposeRecognition(false)
    },
    capabilities,
  }
}
