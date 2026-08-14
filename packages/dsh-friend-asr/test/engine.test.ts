import { describe, expect, it } from 'vitest'

import { resolveAsrEngine, selectAsrEngine, type AsrEngine } from '../src/engine.ts'
import {
  createWebSpeechEngine,
  emitFromResultEvent,
  inspectWebSpeechCapabilities,
  type SpeechRecognitionConstructor,
} from '../src/engines/webspeech.ts'
import {
  createFakeEngine,
  createSpeechRecognitionWorld,
  FakeSpeechRecognition,
} from './helpers/speech-recognition.ts'

describe('WebSpeech AsrEngine', () => {
  it('drives partial then final from a SpeechRecognition stub without throwing', () => {
    const world = createSpeechRecognitionWorld()
    const engine = createWebSpeechEngine({ globals: world.globals, lang: 'zh-CN' })
    const partials: string[] = []
    const finals: string[] = []
    engine.onPartial = (text) => {
      partials.push(text)
    }
    engine.onFinal = (text) => {
      finals.push(text)
    }

    expect(engine.capabilities()).toMatchObject({ available: true, engineId: 'webspeech' })
    engine.start('hold')

    const rec = world.last()
    expect(rec.interimResults).toBe(true)
    expect(rec.continuous).toBe(false)
    expect(rec.lang).toBe('zh-CN')
    expect(rec.started).toBe(true)

    rec.emitPartial('今天')
    rec.emitPartial('今天天气')
    rec.emitFinal('今天天气不错')

    expect(partials).toEqual(['今天', '今天天气'])
    expect(finals).toEqual(['今天天气不错'])
  })

  it('does not re-emit a final already consumed when Chrome repeats the result list', () => {
    const finals: string[] = []
    const partials: string[] = []
    const seen = new Map<number, { isFinal: boolean; text: string }>()
    const first = { isFinal: true, length: 1, 0: { transcript: '为什么哈啰' } }
    emitFromResultEvent(
      { resultIndex: 0, results: [first] },
      (text) => {
        partials.push(text)
      },
      (text) => {
        finals.push(text)
      },
      seen,
    )
    emitFromResultEvent(
      { resultIndex: 0, results: [first, { isFinal: false, length: 1, 0: { transcript: '下一句' } }] },
      (text) => {
        partials.push(text)
      },
      (text) => {
        finals.push(text)
      },
      seen,
    )
    expect(finals).toEqual(['为什么哈啰'])
    expect(partials).toEqual(['下一句'])
  })

  it('emits each new final separately so a replayed segment is not glued to the next', () => {
    const finals: string[] = []
    emitFromResultEvent(
      {
        resultIndex: 0,
        results: [
          { isFinal: true, length: 1, 0: { transcript: '我觉得你非常的OK啊如此可教也' } },
          { isFinal: true, length: 1, 0: { transcript: '不过我觉得你还应该还有很多能进步的空间你觉得怎么样' } },
        ],
      },
      undefined,
      (text) => {
        finals.push(text)
      },
    )
    expect(finals).toEqual([
      '我觉得你非常的OK啊如此可教也',
      '不过我觉得你还应该还有很多能进步的空间你觉得怎么样',
    ])
  })

  it('resets result-index history after an auto-mode onend restart', () => {
    const world = createSpeechRecognitionWorld()
    const engine = createWebSpeechEngine({ globals: world.globals })
    const finals: string[] = []
    engine.onFinal = (text) => {
      finals.push(text)
    }
    engine.start('auto')
    const rec = world.last()
    rec.emitFinal('哈啰哈啰能听到我说话吗')
    rec.onend?.()
    expect(rec.startCalls).toBe(2)
    rec.emitFinal('哈啰哈啰能听到我说话吗')
    expect(finals).toEqual([
      '哈啰哈啰能听到我说话吗',
      '哈啰哈啰能听到我说话吗',
    ])
    engine.stop()
  })

  it('does not trim a new result just because it starts with the previous result', () => {
    const world = createSpeechRecognitionWorld()
    const engine = createWebSpeechEngine({ globals: world.globals })
    const finals: string[] = []
    engine.onFinal = (text) => {
      finals.push(text)
    }
    engine.start('auto')
    const rec = world.last()
    rec.emitFinal('好的')
    rec.emit([
      { isFinal: true, length: 1, 0: { transcript: '好的' } },
      { isFinal: true, length: 1, 0: { transcript: '好的，我们开始' } },
    ], 1)
    expect(finals).toEqual([
      '好的',
      '好的，我们开始',
    ])
    engine.stop()
  })

  it('emits only each new suffix when Chrome keeps growing one cumulative final', () => {
    const world = createSpeechRecognitionWorld()
    const engine = createWebSpeechEngine({ globals: world.globals })
    const finals: string[] = []
    engine.onFinal = (text) => {
      finals.push(text)
    }
    engine.start('auto')
    const rec = world.last()

    rec.emitFinal('我觉得还好吧就是')
    rec.emitFinal('我觉得还好吧就是确实是熬过没事都是先成年就是罢了')
    rec.emitFinal('我觉得还好吧就是确实是熬过没事都是先成年就是罢了第三句')

    expect(finals).toEqual([
      '我觉得还好吧就是',
      '确实是熬过没事都是先成年就是罢了',
      '第三句',
    ])
    engine.stop()
  })

  it('enables continuous for auto and toggle, and follows a live language getter', () => {
    const world = createSpeechRecognitionWorld()
    let lang = 'en-US'
    const engine = createWebSpeechEngine({ globals: world.globals, getLang: () => lang })

    engine.start('auto')
    expect(world.last().continuous).toBe(true)
    expect(world.last().lang).toBe('en-US')

    lang = 'zh-CN'
    engine.start('toggle')
    expect(world.last().continuous).toBe(true)
    expect(world.last().lang).toBe('zh-CN')
  })

  it('reports unavailable and does not throw when SpeechRecognition is missing', () => {
    const engine = createWebSpeechEngine({
      globals: { navigator: { userAgent: 'Mozilla/5.0' } },
    })
    const errors: string[] = []
    engine.onError = (reason) => {
      errors.push(reason)
    }

    expect(() => engine.capabilities()).not.toThrow()
    expect(engine.capabilities().available).toBe(false)
    expect(engine.capabilities().reason).toMatch(/SpeechRecognition/)
    expect(() => engine.start('hold')).not.toThrow()
    expect(errors.length).toBeGreaterThan(0)
  })

  it('reports Safari as unavailable even if webkitSpeechRecognition exists', () => {
    const world = createSpeechRecognitionWorld(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    )
    const caps = inspectWebSpeechCapabilities({
      webkitSpeechRecognition: world.globals.SpeechRecognition,
      navigator: world.globals.navigator,
    })
    expect(caps.available).toBe(false)
    expect(caps.reasonCode).toBe('safari')
    expect(caps.reason).toMatch(/Safari/)

    const engine = createWebSpeechEngine({
      globals: {
        webkitSpeechRecognition: world.globals.SpeechRecognition,
        navigator: world.globals.navigator,
      },
    })
    expect(() => engine.start('hold')).not.toThrow()
    expect(world.instances).toHaveLength(0)
  })

  it('reports the desktop shell WebView as unavailable', () => {
    const caps = inspectWebSpeechCapabilities({
      SpeechRecognition: createSpeechRecognitionWorld().globals.SpeechRecognition,
      navigator: { userAgent: 'Mozilla/5.0 Tauri/2.0 dsh-friend-shell' },
    })
    expect(caps.available).toBe(false)
    expect(caps.reasonCode).toBe('desktop-shell')
    expect(caps.reason).toMatch(/桌面壳|WebView/)
  })

  it('retries auto start after not-allowed once the user gestures', () => {
    const listeners = new Map<string, Array<() => void>>()
    const previousAdd = (globalThis as { addEventListener?: typeof addEventListener }).addEventListener
    const previousRemove = (globalThis as { removeEventListener?: typeof removeEventListener }).removeEventListener
    ;(globalThis as { addEventListener: (type: string, listener: () => void) => void }).addEventListener = (type, listener) => {
      const list = listeners.get(type) ?? []
      list.push(listener)
      listeners.set(type, list)
    }
    ;(globalThis as { removeEventListener: (type: string, listener: () => void) => void }).removeEventListener = (type, listener) => {
      listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener))
    }
    try {
      const world = createSpeechRecognitionWorld()
      const engine = createWebSpeechEngine({ globals: world.globals })
      const errors: string[] = []
      engine.onError = (reason) => {
        errors.push(reason)
      }
      engine.start('auto')
      expect(world.instances).toHaveLength(1)
      world.last().emitError('not-allowed')
      expect(errors).toEqual([])
      for (const listener of listeners.get('pointerdown') ?? []) listener()
      expect(world.instances.length).toBeGreaterThanOrEqual(2)
      engine.stop()
    } finally {
      if (previousAdd === undefined) {
        delete (globalThis as { addEventListener?: typeof addEventListener }).addEventListener
      } else {
        ;(globalThis as { addEventListener: typeof addEventListener }).addEventListener = previousAdd
      }
      if (previousRemove === undefined) {
        delete (globalThis as { removeEventListener?: typeof removeEventListener }).removeEventListener
      } else {
        ;(globalThis as { removeEventListener: typeof removeEventListener }).removeEventListener = previousRemove
      }
    }
  })

  it('does not throw when start() fails, and stop() is safe when idle', () => {
    const Boom = function Boom(): FakeSpeechRecognition {
      const instance = new FakeSpeechRecognition()
      instance.startError = new Error('already started')
      return instance
    }
    const engine = createWebSpeechEngine({
      globals: {
        SpeechRecognition: Boom as unknown as SpeechRecognitionConstructor,
        navigator: { userAgent: 'Mozilla/5.0 Chrome/120.0.0.0' },
      },
    })
    const errors: string[] = []
    engine.onError = (reason) => {
      errors.push(reason)
    }
    expect(() => engine.start('hold')).not.toThrow()
    expect(errors.some((row) => /already started/.test(row))).toBe(true)
    expect(() => engine.stop()).not.toThrow()
    engine.stop()
  })
})

describe('selectAsrEngine', () => {
  it('picks the first engine whose capabilities().available is true', () => {
    const down = createFakeEngine().engine
    down.capabilities = () => ({
      available: false,
      engineId: 'webspeech',
      reason: 'down',
      interimResults: false,
      continuous: false,
    })
    const up = createFakeEngine().engine
    expect(selectAsrEngine([down, up])).toBe(up)
    expect(selectAsrEngine([down])).toBeUndefined()
  })

  it('is typed as an AsrEngine and does not require a concrete class', () => {
    const engine: AsrEngine = createFakeEngine().engine
    expect(engine.capabilities().available).toBe(true)
  })

  it('resolveAsrEngine honors auto and explicit preference', () => {
    const webspeech = createFakeEngine().engine
    const endpoint = createFakeEngine().engine
    endpoint.capabilities = () => ({
      available: true,
      engineId: 'endpoint',
      interimResults: false,
      continuous: false,
    })
    expect(resolveAsrEngine('auto', [webspeech, endpoint]).engineId).toBe('webspeech')
    expect(resolveAsrEngine('endpoint', [webspeech, endpoint]).engineId).toBe('endpoint')
  })
})
