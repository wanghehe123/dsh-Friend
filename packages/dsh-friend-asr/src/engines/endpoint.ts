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

export type MediaRecorderConstructor = new (
  stream: MediaStreamLike,
  options?: { mimeType?: string },
) => MediaRecorderLike

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

export type EndpointEngineOptions = {
  globals?: EndpointGlobals
  fetch?: typeof fetch
  transcribePath?: string
  mimeType?: string
  getLang?: () => string
}

function readGlobalEndpoint(): EndpointGlobals {
  return globalThis as unknown as EndpointGlobals
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
  let startGeneration = 0

  const capabilities = (): AsrEngineCapabilities => inspectEndpointCapabilities(globals)

  const releaseStream = (): void => {
    if (stream === undefined) {
      return
    }
    for (const track of stream.getTracks()) {
      track.stop()
    }
    stream = undefined
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

  const startRecording = async (generation: number): Promise<void> => {
    const Ctor = globals.MediaRecorder
    const getUserMedia = globals.navigator?.mediaDevices?.getUserMedia
    const diagnosis = capabilities()
    if (!diagnosis.available || Ctor === undefined || getUserMedia === undefined) {
      onError?.(diagnosis.reason ?? 'endpoint-unavailable')
      return
    }
    try {
      const nextStream = await getUserMedia({ audio: true })
      if (!wanted || generation !== startGeneration) {
        for (const track of nextStream.getTracks()) {
          track.stop()
        }
        return
      }
      stream = nextStream
      chunks = []
      const instance = new Ctor(stream, { mimeType })
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
        const blob = new Blob(chunks, { type: mimeType.split(';')[0] ?? 'audio/webm' })
        chunks = []
        releaseStream()
        recorder = undefined
        if (!wanted && blob.size === 0) {
          return
        }
        void upload(blob).catch((error: unknown) => {
          onError?.(error instanceof Error ? error.message : 'asr-endpoint-upload-failed')
        })
      }
      instance.start()
    } catch (error) {
      releaseStream()
      recorder = undefined
      onError?.(error instanceof Error ? error.message : 'getUserMedia-failed')
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
    start(_mode: AsrListenMode) {
      wanted = true
      const generation = startGeneration + 1
      startGeneration = generation
      void startRecording(generation)
    },
    stop() {
      wanted = false
      startGeneration += 1
      const current = recorder
      if (current === undefined) {
        releaseStream()
        return
      }
      try {
        current.stop()
      } catch {
        releaseStream()
        recorder = undefined
      }
    },
    capabilities,
  }
}
