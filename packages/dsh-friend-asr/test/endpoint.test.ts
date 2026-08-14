import { describe, expect, it, vi } from 'vitest'

import { createAsrSession } from '../src/session.ts'
import {
  createEndpointEngine,
  inspectEndpointCapabilities,
  type EndpointGlobals,
  type MediaRecorderLike,
  type MediaStreamLike,
} from '../src/engines/endpoint.ts'
import { FRIEND_ASR_TRANSCRIBE_PATH } from '../src/paths.ts'

function createEndpointWorld() {
  const streams: MediaStreamLike[] = []
  const recorders: MediaRecorderLike[] = []
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
      this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }) })
      this.onstop?.()
    }
  }
  const globals: EndpointGlobals = {
    MediaRecorder: FakeRecorder,
    navigator: {
      mediaDevices: {
        async getUserMedia() {
          const stream: MediaStreamLike = {
            getTracks: () => [{ stop: vi.fn() }],
          }
          streams.push(stream)
          return stream
        },
      },
    },
  }
  const original = globals.MediaRecorder
  if (original !== undefined) {
    const Wrapped = function Wrapped(this: unknown, stream: MediaStreamLike, options?: { mimeType?: string }) {
      const instance = new FakeRecorder()
      recorders.push(instance)
      void stream
      void options
      return instance
    }
    globals.MediaRecorder = Wrapped as unknown as EndpointGlobals['MediaRecorder']
  }
  return { globals, recorders, streams }
}

describe('endpoint AsrEngine (W-M3-5)', () => {
  it('reports unavailable without MediaRecorder and does not throw', () => {
    const caps = inspectEndpointCapabilities({ navigator: {} })
    expect(caps.available).toBe(false)
    expect(caps.reasonCode).toBe('missing-media-recorder')
    const engine = createEndpointEngine({ globals: { navigator: {} } })
    expect(() => engine.start('hold')).not.toThrow()
    expect(() => engine.stop()).not.toThrow()
  })

  it('uploads recorded audio to /friend/asr/transcribe and emits onFinal', async () => {
    const world = createEndpointWorld()
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(FRIEND_ASR_TRANSCRIBE_PATH)
      return new Response(JSON.stringify({ text: '今天天气不错' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const engine = createEndpointEngine({ globals: world.globals, fetch: fetchFn as unknown as typeof fetch })
    const finals: string[] = []
    engine.onFinal = (text) => {
      finals.push(text)
    }
    engine.start('hold')
    await vi.waitFor(() => {
      expect(world.recorders).toHaveLength(1)
    })
    engine.stop()
    await vi.waitFor(() => {
      expect(finals).toEqual(['今天天气不错'])
    })
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('invokes getUserMedia with its MediaDevices receiver', async () => {
    const world = createEndpointWorld()
    const receivers: unknown[] = []
    const stream: MediaStreamLike = {
      getTracks: () => [{ stop: vi.fn() }],
    }
    const mediaDevices = {
      async getUserMedia(this: unknown) {
        receivers.push(this)
        return stream
      },
    }
    world.globals.navigator = { mediaDevices }
    const engine = createEndpointEngine({ globals: world.globals })

    engine.start('toggle')
    await vi.waitFor(() => {
      expect(world.recorders).toHaveLength(1)
    })

    expect(receivers).toEqual([mediaDevices])
    engine.stop()
  })

  it('still uploads when stop() lands before getUserMedia resolves', async () => {
    let grant: ((stream: MediaStreamLike) => void) | undefined
    const world = createEndpointWorld()
    world.globals.navigator = {
      mediaDevices: {
        getUserMedia() {
          return new Promise((resolve) => {
            grant = resolve
          })
        },
      },
    }
    const fetchFn = vi.fn(async () => {
      return new Response(JSON.stringify({ text: '点按也能转写' }), { status: 200 })
    })
    const engine = createEndpointEngine({
      globals: world.globals,
      fetch: fetchFn as unknown as typeof fetch,
    })
    const finals: string[] = []
    engine.onFinal = (text) => {
      finals.push(text)
    }
    engine.start('hold')
    engine.stop()
    grant?.({ getTracks: () => [{ stop: vi.fn() }] })
    await vi.waitFor(() => {
      expect(finals).toEqual(['点按也能转写'])
    })
  })

  it('does not fail the session on NotAllowedError; a later gesture retries', async () => {
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
      let allow = false
      const world = createEndpointWorld()
      world.globals.navigator = {
        mediaDevices: {
          async getUserMedia() {
            if (!allow) {
              const error = new Error('Permission denied')
              error.name = 'NotAllowedError'
              throw error
            }
            return { getTracks: () => [{ stop: vi.fn() }] }
          },
        },
      }
      const errors: string[] = []
      const engine = createEndpointEngine({ globals: world.globals })
      engine.onError = (reason) => {
        errors.push(reason)
      }
      engine.start('auto')
      await Promise.resolve()
      await Promise.resolve()
      expect(errors).toEqual([])
      expect(world.recorders).toHaveLength(0)
      allow = true
      for (const listener of listeners.get('pointerdown') ?? []) listener()
      await vi.waitFor(() => {
        expect(world.recorders).toHaveLength(1)
      })
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

  it('auto-listen flushes on energy silence and keeps the mic open', async () => {
    vi.useFakeTimers()
    const world = createEndpointWorld()
    let onLevel: ((rms: number) => void) | undefined
    const fetchFn = vi.fn(async () => {
      return new Response(JSON.stringify({ text: '自定义端点一句' }), { status: 200 })
    })
    const engine = createEndpointEngine({
      globals: world.globals,
      fetch: fetchFn as unknown as typeof fetch,
      getSilenceMs: () => 800,
      watchEnergy: (_stream, report) => {
        onLevel = report
        return () => {
          onLevel = undefined
        }
      },
    })
    const finals: string[] = []
    engine.onFinal = (text) => {
      finals.push(text)
    }
    engine.start('auto')
    await vi.waitFor(() => {
      expect(world.recorders).toHaveLength(1)
    })
    onLevel?.(0.4)
    onLevel?.(0.01)
    await vi.advanceTimersByTimeAsync(800)
    vi.useRealTimers()
    await vi.waitFor(() => {
      expect(finals).toEqual(['自定义端点一句'])
    })
    expect(world.recorders.length).toBeGreaterThanOrEqual(2)
    engine.stop()
  })

  it('reuses the hold session machine (W-M3-2) with the endpoint engine', async () => {
    const world = createEndpointWorld()
    const fetchFn = vi.fn(async () => {
      return new Response(JSON.stringify({ text: '按住说话' }), { status: 200 })
    })
    const engine = createEndpointEngine({ globals: world.globals, fetch: fetchFn as unknown as typeof fetch })
    const sent: string[] = []
    const session = createAsrSession({
      engine,
      onSend: (text) => {
        sent.push(text)
      },
    })
    session.dispatch({ type: 'hotkey-down' })
    await Promise.resolve()
    await Promise.resolve()
    engine.onFinal?.('按住说话')
    session.dispatch({ type: 'hotkey-up' })
    expect(sent).toEqual(['按住说话'])
    session.dispose()
  })
})
