import { describe, expect, it } from 'vitest'

import { resolveAsrEngine, selectAsrEngine, type AsrEngine } from '../src/engine.ts'
import {
  createWebSpeechEngine,
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
