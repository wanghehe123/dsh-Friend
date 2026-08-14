import { createStrictCordisCtx } from '@wishp3/dsh-friend-shared'
import { describe, expect, it, vi } from 'vitest'

import { apply, startAsrClient, type FriendAsrClientContext } from '../src/client.ts'
import { createAsrSession } from '../src/session.ts'
import { createWebSpeechEngine } from '../src/engines/webspeech.ts'
import {
  readFriendAsrSettings,
  type AsrSettingsBinder,
  type AsrSettingsScope,
  type FriendAsrSettings,
} from '../src/settings.ts'
import { createFakeEngine, createSpeechRecognitionWorld } from './helpers/speech-recognition.ts'

function liveAsrScope(initial: Record<string, unknown> = {}): {
  binder: AsrSettingsBinder
  push(patch: Record<string, unknown>): void
  value(): FriendAsrSettings
  listenerCount(): number
} {
  let value = readFriendAsrSettings(initial)
  const listeners = new Set<() => void>()
  const scope: AsrSettingsScope = {
    getSnapshot: () => ({
      status: 'ready',
      value,
      base: initial,
      user: initial,
      revision: 1,
      writable: true,
      mode: 'memory',
    }),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: async () => {},
    unset: async () => {},
  }
  return {
    binder: { bind: () => scope },
    push(patch) {
      value = readFriendAsrSettings({ ...value, ...patch })
      for (const listener of listeners) {
        listener()
      }
    },
    value: () => value,
    listenerCount: () => listeners.size,
  }
}

describe('AsrSession.setEngine hot-swap', () => {
  it('stops and unbinds the old engine while listening, then starts the new one', () => {
    const first = createFakeEngine('webspeech')
    const second = createFakeEngine('endpoint')
    const sent: string[] = []
    const session = createAsrSession({
      engine: first.engine,
      onSend: (text) => {
        sent.push(text)
      },
    })

    session.dispatch({ type: 'hotkey-down' })
    expect(first.starts).toEqual(['hold'])
    expect(session.getState().phase).toBe('listening')

    session.setEngine(second.engine)

    expect(first.stops).toBe(1)
    expect(first.engine.onPartial).toBeUndefined()
    expect(first.engine.onFinal).toBeUndefined()
    expect(first.engine.onError).toBeUndefined()
    expect(second.starts).toEqual(['hold'])
    expect(second.engine.onFinal).toBeTypeOf('function')
    expect(session.getEngine()).toBe(second.engine)
    expect(session.getState().phase).toBe('listening')

    first.emitFinal('旧引擎残留')
    expect(sent).toEqual([])
    second.emitFinal('新引擎接管')
    session.dispatch({ type: 'hotkey-up' })
    expect(sent).toEqual(['新引擎接管'])
    session.dispose()
  })

  it('still binds the new engine when the old stop() throws', () => {
    const first = createFakeEngine('webspeech')
    const second = createFakeEngine('endpoint')
    first.engine.stop = () => {
      throw new Error('stop failed')
    }
    const session = createAsrSession({ engine: first.engine })
    session.dispatch({ type: 'hotkey-down' })
    expect(() => session.setEngine(second.engine)).not.toThrow()
    expect(first.engine.onFinal).toBeUndefined()
    expect(second.starts).toEqual(['hold'])
    expect(session.getEngine()).toBe(second.engine)
    session.dispose()
  })

  it('rapid consecutive swaps leave only the last engine bound', () => {
    const engines = [
      createFakeEngine('webspeech'),
      createFakeEngine('endpoint'),
      createFakeEngine('webspeech'),
    ]
    const session = createAsrSession({ engine: engines[0]!.engine })
    session.dispatch({ type: 'hotkey-down' })
    session.setEngine(engines[1]!.engine)
    session.setEngine(engines[2]!.engine)
    session.setEngine(engines[1]!.engine)

    expect(engines[0]!.engine.onFinal).toBeUndefined()
    expect(engines[2]!.engine.onFinal).toBeUndefined()
    expect(engines[1]!.engine.onFinal).toBeTypeOf('function')
    expect(session.getEngine()).toBe(engines[1]!.engine)
    expect(engines[0]!.stops).toBeGreaterThanOrEqual(1)
    expect(engines[2]!.stops).toBeGreaterThanOrEqual(1)
    expect(engines[1]!.starts.length).toBeGreaterThanOrEqual(2)
    session.dispose()
    expect(engines[1]!.engine.onFinal).toBeUndefined()
  })
})

describe('startAsrClient live engine and language', () => {
  it('rebinds the catalog engine when settings.engine changes mid-recording', () => {
    const webspeech = createFakeEngine('webspeech')
    const endpoint = createFakeEngine('endpoint')
    const live = liveAsrScope({ engine: 'webspeech', language: 'zh-CN', mode: 'hold' })
    const sent: string[] = []
    const handle = startAsrClient({
      engines: [webspeech.engine, endpoint.engine],
      settingsScope: live.binder,
      onSend: (text) => {
        sent.push(text)
      },
    })

    handle.session.dispatch({ type: 'hotkey-down' })
    expect(handle.engine).toBe(webspeech.engine)
    expect(webspeech.starts).toEqual(['hold'])

    live.push({ engine: 'endpoint' })
    expect(handle.engine).toBe(endpoint.engine)
    expect(webspeech.stops).toBe(1)
    expect(webspeech.engine.onPartial).toBeUndefined()
    expect(webspeech.engine.onFinal).toBeUndefined()
    expect(endpoint.starts).toEqual(['hold'])
    expect(endpoint.engine.onFinal).toBeTypeOf('function')

    webspeech.emitFinal('悬挂会话')
    expect(sent).toEqual([])
    endpoint.emitFinal('endpoint 接管')
    handle.session.dispatch({ type: 'hotkey-up' })
    expect(sent).toEqual(['endpoint 接管'])
    handle.dispose()
  })

  it('does not leak handlers across a burst of engine flips', () => {
    const webspeech = createFakeEngine('webspeech')
    const endpoint = createFakeEngine('endpoint')
    const live = liveAsrScope({ engine: 'webspeech', mode: 'hold' })
    const handle = startAsrClient({
      engines: [webspeech.engine, endpoint.engine],
      settingsScope: live.binder,
    })
    handle.session.dispatch({ type: 'hotkey-down' })

    for (let index = 0; index < 8; index += 1) {
      live.push({ engine: index % 2 === 0 ? 'endpoint' : 'webspeech' })
    }

    expect(handle.engine).toBe(webspeech.engine)
    expect(endpoint.engine.onFinal).toBeUndefined()
    expect(webspeech.engine.onFinal).toBeTypeOf('function')
    expect(webspeech.stops).toBeGreaterThanOrEqual(4)
    expect(endpoint.stops).toBeGreaterThanOrEqual(4)
    handle.dispose()
    expect(webspeech.engine.onFinal).toBeUndefined()
    expect(endpoint.engine.onFinal).toBeUndefined()
  })

  it('uses the new language on the next recognition after a settings push', () => {
    const world = createSpeechRecognitionWorld()
    const live = liveAsrScope({ engine: 'webspeech', language: 'zh-CN', mode: 'hold' })
    const handle = startAsrClient({
      window: world.globals,
      settingsScope: live.binder,
    })

    handle.session.dispatch({ type: 'hotkey-down' })
    expect(world.last().lang).toBe('zh-CN')
    handle.session.dispatch({ type: 'hotkey-up' })

    live.push({ language: 'en-US' })
    handle.session.dispatch({ type: 'hotkey-down' })
    expect(world.last().lang).toBe('en-US')
    handle.session.dispatch({ type: 'hotkey-up' })
    handle.dispose()
  })

  it('does not rebind when the caller pinned an engine', () => {
    const pinned = createFakeEngine('webspeech')
    const other = createFakeEngine('endpoint')
    const live = liveAsrScope({ engine: 'webspeech', mode: 'hold' })
    const handle = startAsrClient({
      engine: pinned.engine,
      engines: [pinned.engine, other.engine],
      settingsScope: live.binder,
    })
    handle.session.dispatch({ type: 'hotkey-down' })
    live.push({ engine: 'endpoint' })
    expect(handle.engine).toBe(pinned.engine)
    expect(other.starts).toEqual([])
    handle.dispose()
  })
})

describe('apply() / startAsrClient on a strict ctx (only settingsScope injected)', () => {
  it('apply() binds settingsScope and does not read window / document off ctx', () => {
    const live = liveAsrScope({ engine: 'webspeech', language: 'zh-CN' })
    const ctx = createStrictCordisCtx({
      inject: ['settingsScope'],
      values: { settingsScope: live.binder },
    })
    expect(() => ctx.window).toThrow(/cannot get property "window" without inject/)
    expect(() => ctx.document).toThrow(/cannot get property "document" without inject/)
    expect(() => ctx.engine).toThrow(/cannot get property "engine" without inject/)

    const handle = apply(ctx as FriendAsrClientContext)
    expect(live.listenerCount()).toBe(1)
    handle.dispose()
    expect(live.listenerCount()).toBe(0)
  })

  it('throws when apply() reads settingsScope on a ctx that did not inject it', () => {
    const ctx = createStrictCordisCtx({ inject: [] })
    expect(() => apply(ctx as FriendAsrClientContext)).toThrow(
      /cannot get property "settingsScope" without inject/,
    )
  })

  it('hot-swaps engine when settingsScope is the only injected ctx service', () => {
    const webspeech = createFakeEngine('webspeech')
    const endpoint = createFakeEngine('endpoint')
    const live = liveAsrScope({ engine: 'webspeech', language: 'zh-CN', mode: 'hold' })
    const ctx = createStrictCordisCtx({
      inject: ['settingsScope'],
      values: { settingsScope: live.binder },
    })
    const settingsScope = ctx.settingsScope as AsrSettingsBinder
    const handle = startAsrClient({
      engines: [webspeech.engine, endpoint.engine],
      settingsScope,
    })

    handle.session.dispatch({ type: 'hotkey-down' })
    expect(handle.engine).toBe(webspeech.engine)
    live.push({ engine: 'endpoint' })
    expect(handle.engine).toBe(endpoint.engine)
    expect(webspeech.stops).toBe(1)
    expect(endpoint.starts).toEqual(['hold'])
    handle.dispose()
  })

  it('uses the new language after a settings push when settingsScope is the only injected ctx service', () => {
    const world = createSpeechRecognitionWorld()
    const live = liveAsrScope({ engine: 'webspeech', language: 'zh-CN', mode: 'hold' })
    const ctx = createStrictCordisCtx({
      inject: ['settingsScope'],
      values: { settingsScope: live.binder },
    })
    const handle = startAsrClient({
      window: world.globals,
      settingsScope: ctx.settingsScope as AsrSettingsBinder,
    })

    handle.session.dispatch({ type: 'hotkey-down' })
    expect(world.last().lang).toBe('zh-CN')
    handle.session.dispatch({ type: 'hotkey-up' })

    live.push({ language: 'en-US' })
    handle.session.dispatch({ type: 'hotkey-down' })
    expect(world.last().lang).toBe('en-US')
    handle.session.dispatch({ type: 'hotkey-up' })
    handle.dispose()
  })
})

describe('WebSpeech engine language getter', () => {
  it('reads getLang on every start, not only at construction', () => {
    const world = createSpeechRecognitionWorld()
    let lang = 'zh-CN'
    const engine = createWebSpeechEngine({ globals: world.globals, getLang: () => lang })
    engine.start('hold')
    expect(world.last().lang).toBe('zh-CN')
    engine.stop()
    lang = 'ja-JP'
    engine.start('hold')
    expect(world.last().lang).toBe('ja-JP')
    engine.stop()
  })
})

describe('endpoint upload language header follows getLang', () => {
  it('sends the language that is current at upload time', async () => {
    const { createEndpointEngine } = await import('../src/engines/endpoint.ts')
    type EndpointGlobals = import('../src/engines/endpoint.ts').EndpointGlobals
    type MediaRecorderLike = import('../src/engines/endpoint.ts').MediaRecorderLike
    type MediaStreamLike = import('../src/engines/endpoint.ts').MediaStreamLike

    class FakeRecorder implements MediaRecorderLike {
      ondataavailable: MediaRecorderLike['ondataavailable'] = null
      onstop: MediaRecorderLike['onstop'] = null
      onerror: MediaRecorderLike['onerror'] = null
      state = 'inactive'
      start() {
        this.state = 'recording'
      }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob([new Uint8Array([1])], { type: 'audio/webm' }) })
        this.onstop?.()
      }
    }
    const recorders: FakeRecorder[] = []
    const globals: EndpointGlobals = {
      MediaRecorder: function Wrapped() {
        const instance = new FakeRecorder()
        recorders.push(instance)
        return instance
      } as unknown as EndpointGlobals['MediaRecorder'],
      navigator: {
        mediaDevices: {
          async getUserMedia() {
            const stream: MediaStreamLike = { getTracks: () => [{ stop: vi.fn() }] }
            return stream
          },
        },
      },
    }
    let lang = 'zh-CN'
    const headers: Array<string | null> = []
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const hdrs = new Headers(init?.headers)
      headers.push(hdrs.get('x-friend-asr-language'))
      return new Response(JSON.stringify({ text: 'ok' }), { status: 200 })
    })
    const engine = createEndpointEngine({
      globals,
      fetch: fetchFn as unknown as typeof fetch,
      getLang: () => lang,
    })
    engine.start('hold')
    await vi.waitFor(() => {
      expect(recorders).toHaveLength(1)
    })
    lang = 'en-GB'
    engine.stop()
    await vi.waitFor(() => {
      expect(headers).toEqual(['en-GB'])
    })
  })
})
