/**
 * Client endpoint engine: MediaRecorder (webm/opus) → POST /friend/asr/transcribe.
 * The host proxy forwards to an OpenAI-compatible `/audio/transcriptions`.
 */
import type {
  AsrEngine,
  AsrEngineCapabilities,
  AsrErrorHandler,
  AsrListenMode,
  AsrTranscriptHandler,
} from '../engine.ts'
import { ASR_DEFAULT_SILENCE_MS } from '../modes.ts'
import { FRIEND_ASR_TRANSCRIBE_PATH } from '../paths.ts'

export const ENDPOINT_ENGINE_ID = 'endpoint' as const

export type MediaRecorderLike = {
  start(): void
  stop(): void
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: ((event: { error?: { message?: string } }) => void) | null
  state: string
}

export type MediaRecorderConstructor = (new (
  stream: MediaStreamLike,
  options?: { mimeType?: string },
) => MediaRecorderLike) & {
  isTypeSupported?(mimeType: string): boolean
}

export type MediaStreamLike = {
  getTracks(): Array<{ stop(): void }>
}

export type EndpointGlobals = {
  MediaRecorder?: MediaRecorderConstructor
  navigator?: {
    mediaDevices?: {
      getUserMedia(constraints: { audio: boolean }): Promise<MediaStreamLike>
    }
  }
}

export type EndpointEnergyWatch = (
  stream: MediaStreamLike,
  onLevel: (rms: number) => void,
) => () => void

export type EndpointEngineOptions = {
  globals?: EndpointGlobals
  fetch?: typeof fetch
  transcribePath?: string
  mimeType?: string
  getLang?: () => string
  getSilenceMs?: () => number
  watchEnergy?: EndpointEnergyWatch
}

function readGlobalEndpoint(): EndpointGlobals {
  return globalThis as unknown as EndpointGlobals
}

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] as const
const SPEECH_RMS = 0.02

function isContinuousMode(mode: AsrListenMode): boolean {
  return mode === 'auto' || mode === 'toggle'
}

function isGestureMicError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
    return true
  }
  return /notallowed|not-allowed|permission denied/i.test(error.message)
}

function createAnalyserEnergyWatch(): EndpointEnergyWatch | undefined {
  const AudioCtor = (globalThis as {
    AudioContext?: new () => AudioContext
    webkitAudioContext?: new () => AudioContext
  }).AudioContext ?? (globalThis as { webkitAudioContext?: new () => AudioContext }).webkitAudioContext
  const raf = globalThis.requestAnimationFrame?.bind(globalThis)
  const caf = globalThis.cancelAnimationFrame?.bind(globalThis)
  if (AudioCtor === undefined || raf === undefined || caf === undefined) {
    return undefined
  }
  return (media, onLevel) => {
    const context = new AudioCtor()
    const source = context.createMediaStreamSource(media as MediaStream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const buffer = new Uint8Array(analyser.fftSize)
    let frame = 0
    const tick = (): void => {
      analyser.getByteTimeDomainData(buffer)
      let sum = 0
      for (const sample of buffer) {
        const centered = (sample - 128) / 128
        sum += centered * centered
      }
      onLevel(Math.sqrt(sum / buffer.length))
      frame = raf(tick)
    }
    void context.resume()
    frame = raf(tick)
    return () => {
      caf(frame)
      try {
        source.disconnect()
      } catch {
        // already disconnected
      }
      void context.close()
    }
  }
}

function pickMimeType(Ctor: MediaRecorderConstructor, preferred: string): string | undefined {
  const seen = new Set<string>()
  for (const mime of [preferred, ...MIME_CANDIDATES]) {
    if (seen.has(mime)) {
      continue
    }
    seen.add(mime)
    if (Ctor.isTypeSupported?.(mime) === false) {
      continue
    }
    return mime
  }
  return undefined
}

export function inspectEndpointCapabilities(globals?: EndpointGlobals): AsrEngineCapabilities {
  const resolved = globals ?? readGlobalEndpoint()
  const hasRecorder = resolved.MediaRecorder !== undefined
  const hasMic = resolved.navigator?.mediaDevices?.getUserMedia !== undefined
  if (!hasRecorder || !hasMic) {
    return {
      available: false,
      engineId: ENDPOINT_ENGINE_ID,
      reason: '当前环境没有 MediaRecorder 或麦克风接口，无法使用自定义 endpoint',
      reasonCode: 'missing-media-recorder',
      interimResults: false,
      continuous: false,
    }
  }
  return {
    available: true,
    engineId: ENDPOINT_ENGINE_ID,
    interimResults: false,
    continuous: false,
  }
}

export function createEndpointEngine(options: EndpointEngineOptions = {}): AsrEngine {
  const globals = options.globals ?? readGlobalEndpoint()
  const fetchFn = options.fetch ?? fetch
  const path = options.transcribePath ?? FRIEND_ASR_TRANSCRIBE_PATH
  const mimeType = options.mimeType ?? 'audio/webm;codecs=opus'

  let onPartial: AsrTranscriptHandler | undefined
  let onFinal: AsrTranscriptHandler | undefined
  let onError: AsrErrorHandler | undefined
  let recorder: MediaRecorderLike | undefined
  let stream: MediaStreamLike | undefined
  let chunks: Blob[] = []
  let wanted = false
  let pendingStop = false
  let opening = false
  let startGeneration = 0
  let activeMode: AsrListenMode = 'hold'
  let heardSpeech = false
  let quietHandle: ReturnType<typeof setTimeout> | undefined
  let unwatchEnergy: (() => void) | undefined
  let gestureUnbind: (() => void) | undefined
  let chosenMime = mimeType

  const capabilities = (): AsrEngineCapabilities => inspectEndpointCapabilities(globals)
  const silenceMs = (): number => {
    const live = options.getSilenceMs?.()
    return live !== undefined && live > 0 ? live : ASR_DEFAULT_SILENCE_MS
  }

  const releaseStream = (): void => {
    unwatchEnergy?.()
    unwatchEnergy = undefined
    if (stream === undefined) {
      return
    }
    for (const track of stream.getTracks()) {
      track.stop()
    }
    stream = undefined
  }

  const clearQuiet = (): void => {
    if (quietHandle === undefined) {
      return
    }
    clearTimeout(quietHandle)
    quietHandle = undefined
  }

  const clearGestureRestart = (): void => {
    gestureUnbind?.()
    gestureUnbind = undefined
  }

  const upload = async (blob: Blob): Promise<void> => {
    const language = options.getLang?.()
    const response = await fetchFn(path, {
      method: 'POST',
      headers: {
        'content-type': blob.type || 'audio/webm',
        ...(language !== undefined && language.length > 0 ? { 'x-friend-asr-language': language } : {}),
      },
      body: blob,
    })
    const raw = await response.text()
    let text = raw
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object') {
        const record = parsed as { text?: unknown; error?: unknown }
        if (typeof record.error === 'string' && !response.ok) {
          throw new Error(record.error)
        }
        if (typeof record.text === 'string') {
          text = record.text
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('asr-endpoint')) {
        throw error
      }
      if (!response.ok) {
        throw new Error(`asr-endpoint: HTTP ${String(response.status)}`)
      }
    }
    if (!response.ok) {
      throw new Error(`asr-endpoint: HTTP ${String(response.status)}`)
    }
    const trimmed = text.trim()
    if (trimmed.length > 0) {
      onFinal?.(trimmed)
    }
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
        const generation = startGeneration + 1
        startGeneration = generation
        void startRecording(generation)
      }
    }
    target.addEventListener?.('pointerdown', onGesture, true)
    target.addEventListener?.('keydown', onGesture, true)
    gestureUnbind = () => {
      target.removeEventListener?.('pointerdown', onGesture, true)
      target.removeEventListener?.('keydown', onGesture, true)
    }
  }

  const attachRecorder = (target: MediaStreamLike): boolean => {
    const Ctor = globals.MediaRecorder
    if (Ctor === undefined) {
      return false
    }
    chunks = []
    chosenMime = pickMimeType(Ctor, mimeType) ?? mimeType
    let instance: MediaRecorderLike
    try {
      instance = chosenMime === undefined
        ? new Ctor(target)
        : new Ctor(target, { mimeType: chosenMime })
    } catch {
      try {
        instance = new Ctor(target)
        chosenMime = 'audio/webm'
      } catch (error) {
        onError?.(error instanceof Error ? error.message : 'media-recorder-start-failed')
        return false
      }
    }
    recorder = instance
    instance.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data)
      }
    }
    instance.onerror = (event) => {
      onError?.(event.error?.message ?? 'media-recorder-error')
    }
    instance.onstop = () => {
      const blob = new Blob(chunks, { type: chosenMime.split(';')[0] ?? 'audio/webm' })
      chunks = []
      recorder = undefined
      const restart = wanted && isContinuousMode(activeMode)
      if (!restart) {
        releaseStream()
      }
      if (!wanted && blob.size === 0) {
        return
      }
      void upload(blob)
        .catch((error: unknown) => {
          onError?.(error instanceof Error ? error.message : 'asr-endpoint-upload-failed')
        })
        .finally(() => {
          if (restart && wanted && stream !== undefined && recorder === undefined) {
            heardSpeech = false
            attachRecorder(stream)
          }
        })
    }
    instance.start()
    if (pendingStop || !wanted) {
      pendingStop = false
      try {
        instance.stop()
      } catch {
        recorder = undefined
        releaseStream()
      }
    }
    return true
  }

  const onEnergy = (rms: number): void => {
    if (!wanted || !isContinuousMode(activeMode)) {
      return
    }
    if (rms >= SPEECH_RMS) {
      const first = !heardSpeech
      heardSpeech = true
      clearQuiet()
      if (first) {
        onPartial?.(' ')
      }
      return
    }
    if (!heardSpeech || quietHandle !== undefined || recorder === undefined) {
      return
    }
    quietHandle = setTimeout(() => {
      quietHandle = undefined
      if (!wanted || recorder === undefined) {
        return
      }
      try {
        recorder.stop()
      } catch {
        recorder = undefined
      }
    }, silenceMs())
  }

  const startEnergyWatch = (target: MediaStreamLike): void => {
    if (unwatchEnergy !== undefined || !isContinuousMode(activeMode)) {
      return
    }
    const watch = options.watchEnergy ?? createAnalyserEnergyWatch()
    if (watch === undefined) {
      return
    }
    try {
      unwatchEnergy = watch(target, onEnergy)
    } catch {
      unwatchEnergy = undefined
    }
  }

  const startRecording = async (generation: number): Promise<void> => {
    const Ctor = globals.MediaRecorder
    const mediaDevices = globals.navigator?.mediaDevices
    const diagnosis = capabilities()
    if (!diagnosis.available || Ctor === undefined || mediaDevices?.getUserMedia === undefined) {
      onError?.(diagnosis.reason ?? 'endpoint-unavailable')
      opening = false
      return
    }
    opening = true
    try {
      const nextStream = await mediaDevices.getUserMedia({ audio: true })
      if (generation !== startGeneration) {
        for (const track of nextStream.getTracks()) {
          track.stop()
        }
        return
      }
      if (!wanted && !pendingStop) {
        for (const track of nextStream.getTracks()) {
          track.stop()
        }
        return
      }
      stream = nextStream
      startEnergyWatch(nextStream)
      attachRecorder(nextStream)
    } catch (error) {
      releaseStream()
      recorder = undefined
      if (wanted && isGestureMicError(error)) {
        armGestureRestart()
        return
      }
      onError?.(error instanceof Error ? error.message : 'getUserMedia-failed')
    } finally {
      if (generation === startGeneration) {
        opening = false
      }
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
    start(mode: AsrListenMode) {
      activeMode = mode
      wanted = true
      pendingStop = false
      clearGestureRestart()
      if (recorder !== undefined || opening) {
        return
      }
      const generation = startGeneration + 1
      startGeneration = generation
      void startRecording(generation)
    },
    stop() {
      wanted = false
      clearQuiet()
      clearGestureRestart()
      heardSpeech = false
      const current = recorder
      if (current === undefined) {
        if (opening) {
          pendingStop = true
          return
        }
        releaseStream()
        return
      }
      try {
        current.stop()
      } catch {
        recorder = undefined
        releaseStream()
      }
    },
    capabilities,
  }
}
