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
