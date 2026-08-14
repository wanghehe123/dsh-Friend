import type { AsrEngine, AsrEngineId, AsrListenMode } from '../../src/engine.ts'
import type {
  SpeechRecognitionConstructor,
  SpeechRecognitionLike,
  SpeechRecognitionResultEventLike,
  SpeechRecognitionResultLike,
  WebSpeechGlobals,
} from '../../src/engines/webspeech.ts'

export class FakeSpeechRecognition implements SpeechRecognitionLike {
  continuous = false
  interimResults = false
  lang = ''
  onresult: SpeechRecognitionLike['onresult'] = null
  onerror: SpeechRecognitionLike['onerror'] = null
  onend: SpeechRecognitionLike['onend'] = null
  started = false
  startCalls = 0
  stopCalls = 0
  abortCalls = 0
  startError: Error | undefined

  start(): void {
    if (this.startError !== undefined) {
      throw this.startError
    }
    this.started = true
    this.startCalls += 1
  }

  stop(): void {
    this.stopCalls += 1
    this.started = false
    this.onend?.()
  }

  abort(): void {
    this.abortCalls += 1
    this.started = false
  }

  emit(results: SpeechRecognitionResultLike[], resultIndex = 0): void {
    const event: SpeechRecognitionResultEventLike = { resultIndex, results }
    this.onresult?.(event)
  }

  emitPartial(text: string): void {
    this.emit([{ isFinal: false, length: 1, 0: { transcript: text } }])
  }

  emitFinal(text: string): void {
    this.emit([{ isFinal: true, length: 1, 0: { transcript: text } }])
  }

  emitError(error: string): void {
    this.onerror?.({ error })
  }
}

export function createSpeechRecognitionWorld(userAgent = 'Mozilla/5.0 Chrome/120.0.0.0'): {
  globals: WebSpeechGlobals
  instances: FakeSpeechRecognition[]
  last(): FakeSpeechRecognition
} {
  const instances: FakeSpeechRecognition[] = []
  function SpeechRecognition(this: unknown): FakeSpeechRecognition {
    const instance = new FakeSpeechRecognition()
    instances.push(instance)
    return instance
  }
  const globals: WebSpeechGlobals = {
    SpeechRecognition: SpeechRecognition as unknown as SpeechRecognitionConstructor,
    navigator: { userAgent },
  }
  return {
    globals,
    instances,
    last() {
      const instance = instances.at(-1)
      if (instance === undefined) {
        throw new Error('SpeechRecognition was not constructed')
      }
      return instance
    },
  }
}

export function createFakeEngine(engineId: AsrEngineId = 'webspeech'): {
  engine: AsrEngine
  starts: AsrListenMode[]
  stops: number
  emitPartial(text: string): void
  emitFinal(text: string): void
  emitError(reason: string): void
} {
  const starts: AsrListenMode[] = []
  let stops = 0
  const engine: AsrEngine = {
    onPartial: undefined,
    onFinal: undefined,
    onError: undefined,
    start(mode) {
      starts.push(mode)
    },
    stop() {
      stops += 1
    },
    capabilities() {
      return {
        available: true,
        engineId,
        interimResults: engineId === 'webspeech',
        continuous: engineId === 'webspeech',
      }
    },
  }
  return {
    engine,
    starts,
    get stops() {
      return stops
    },
    emitPartial(text) {
      engine.onPartial?.(text)
    },
    emitFinal(text) {
      engine.onFinal?.(text)
    },
    emitError(reason) {
      engine.onError?.(reason)
    },
  }
}
