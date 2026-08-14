import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveAsrEngine, startAsrClient } from '../src/browser.ts'
import { createEndpointEngine, type EndpointGlobals, type MediaRecorderLike, type MediaStreamLike } from '../src/engines/endpoint.ts'
import { createWebSpeechEngine } from '../src/engines/webspeech.ts'
import { FRIEND_ASR_TRANSCRIBE_PATH } from '../src/paths.ts'
import { createSpeechRecognitionWorld } from './helpers/speech-recognition.ts'

function createEndpointWorld(): {
  globals: EndpointGlobals
  recorders: MediaRecorderLike[]
} {
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
  return { globals, recorders }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('startAsrClient auto engine on the browser entry', () => {
  it('selects webspeech when SpeechRecognition exists, enters listening, and onSend fires on final', () => {
    const world = createSpeechRecognitionWorld()
    const sent: string[] = []
    const webspeech = createWebSpeechEngine({ globals: world.globals })
    const endpoint = createEndpointEngine({ globals: {} })
    expect(resolveAsrEngine('auto', [webspeech, endpoint]).engineId).toBe('webspeech')

    const handle = startAsrClient({
      window: world.globals,
      endpointGlobals: {},
      onSend: (text) => {
        sent.push(text)
      },
    })

    expect(handle.engine.capabilities()).toMatchObject({ available: true, engineId: 'webspeech' })
    handle.session.dispatch({ type: 'hotkey-down' })
    expect(handle.session.getState().phase).toBe('listening')
    expect(world.last().started).toBe(true)

    world.last().emitFinal('今天天气不错')
    handle.session.dispatch({ type: 'hotkey-up' })
    expect(handle.session.getState().phase).toBe('idle')
    expect(sent).toEqual(['今天天气不错'])
    handle.dispose()
  })

  it('falls back to endpoint when SpeechRecognition is missing, and hotkey-down starts recording', async () => {
    const endpointWorld = createEndpointWorld()
    const sent: string[] = []
    const transcribe = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(FRIEND_ASR_TRANSCRIBE_PATH)
      return new Response(JSON.stringify({ text: '壳内转写成功' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const noSpeechWindow = { navigator: { userAgent: 'Mozilla/5.0' } }
    const webspeech = createWebSpeechEngine({ globals: noSpeechWindow })
    const endpoint = createEndpointEngine({ globals: endpointWorld.globals })
    expect(webspeech.capabilities().available).toBe(false)
    expect(webspeech.capabilities().reasonCode).toBe('missing-speech-recognition')
    expect(resolveAsrEngine('auto', [webspeech, endpoint]).engineId).toBe('endpoint')

    const handle = startAsrClient({
      window: noSpeechWindow,
      endpointGlobals: endpointWorld.globals,
      fetch: transcribe as unknown as typeof fetch,
      onSend: (text) => {
        sent.push(text)
      },
    })

    expect(handle.engine.capabilities()).toMatchObject({ available: true, engineId: 'endpoint' })
    handle.session.dispatch({ type: 'hotkey-down' })
    expect(handle.session.getState().phase).toBe('listening')
    await vi.waitFor(() => {
      expect(endpointWorld.recorders).toHaveLength(1)
    })
    expect(endpointWorld.recorders[0]?.state).toBe('recording')

    handle.session.dispatch({ type: 'hotkey-up' })
    await vi.waitFor(() => {
      expect(sent).toEqual(['壳内转写成功'])
    })
    expect(transcribe).toHaveBeenCalledOnce()
    expect(handle.session.getState().phase).toBe('idle')
    handle.dispose()
  })
})
