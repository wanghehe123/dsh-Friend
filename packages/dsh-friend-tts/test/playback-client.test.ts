import { describe, expect, it, vi } from 'vitest'

import {
  createFriendTtsPlayer,
  type FriendAnalyserLike,
  type FriendAudioContextLike,
  type FriendBufferSourceLike,
  type FriendGainLike,
} from '../src/audio-player.ts'
import { FRIEND_LIPSYNC_EVENT } from '../src/lipsync.ts'
import { attachTtsPlayback } from '../src/playback-client.ts'
import { FRIEND_TTS_FALLBACK_UI_HINT } from '../src/providers/browser.ts'
import { createPlainUtterance, startTtsClient } from '../src/speech-fallback.ts'
import type { SpeechSynthesisLike, SpeechSynthesisUtteranceLike } from '../src/speech-fallback.ts'

function createSynthStub() {
  const utterances: SpeechSynthesisUtteranceLike[] = []
  let speaking = false
  const synth: SpeechSynthesisLike = {
    get speaking() {
      return speaking
    },
    pending: false,
    paused: false,
    getVoices: () => [],
    speak(utterance) {
      utterances.push(utterance)
      speaking = true
    },
    cancel() {
      speaking = false
    },
    pause() {},
    resume() {},
  }
  return {
    synth,
    utterances,
    finishLast() {
      const last = utterances.at(-1)
      speaking = false
      last?.onend?.({})
    },
  }
}

function createAudioMock() {
  const sources: FriendBufferSourceLike[] = []
  const gain: FriendGainLike = { gain: { value: 1 }, connect: vi.fn() }
  const analyser: FriendAnalyserLike = {
    fftSize: 0,
    frequencyBinCount: 128,
    connect: vi.fn(),
    getByteTimeDomainData() {},
  }
  const context: FriendAudioContextLike = {
    state: 'running',
    sampleRate: 48_000,
    destination: {},
    resume: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => ({ duration: 1 })),
    createAnalyser: () => analyser,
    createGain: () => gain,
    createBufferSource() {
      const source: FriendBufferSourceLike = {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      }
      sources.push(source)
      return source
    },
  }
  return { context, sources }
}

describe('TTS playback downlink', () => {
  it('fetches /friend/tts/audio and enqueues bytes on tts-ready audio', async () => {
    const mock = createAudioMock()
    const stub = createSynthStub()
    const bytes = new Uint8Array([1, 2, 3, 4])
    const fetched: string[] = []
    const handle = attachTtsPlayback(
      startTtsClient({
        speechSynthesis: stub.synth,
        createUtterance: createPlainUtterance,
        player: { audioContext: mock.context },
      }),
      {
        fetch: async (url) => {
          fetched.push(url)
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
            arrayBuffer: async () => bytes.buffer,
          }
        },
      },
    )

    const playing = handle.playReady({
      kind: 'audio',
      id: 'abc',
      audioUrl: '/friend/tts/audio/abc',
      mime: 'audio/mpeg',
      providerId: 'edge',
      source: 'preview',
      requestId: 'req-1',
    })
    const started = Date.now()
    while (mock.sources.length === 0 && Date.now() - started < 200) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(fetched).toEqual(['/friend/tts/audio/abc'])
    expect(mock.sources).toHaveLength(1)
    mock.sources[0]?.onended?.()
    await playing
    handle.dispose()
  })

  it('runs speechSynthesis on browser-fallback and does not fetch audio', async () => {
    const stub = createSynthStub()
    const fetched: string[] = []
    const handle = attachTtsPlayback(
      startTtsClient({
        speechSynthesis: stub.synth,
        createUtterance: createPlainUtterance,
      }),
      {
        fetch: async (url) => {
          fetched.push(url)
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
            arrayBuffer: async () => new ArrayBuffer(0),
          }
        },
      },
    )

    const spoken = handle.playReady({
      kind: 'browser-fallback',
      engine: 'speechSynthesis',
      text: '兜底一句',
      uiHint: FRIEND_TTS_FALLBACK_UI_HINT,
      reason: 'provider set to browser',
      source: 'preview',
      requestId: 'req-2',
    })
    expect(stub.utterances[0]?.text).toBe('兜底一句')
    expect(fetched).toEqual([])
    stub.finishLast()
    await spoken
    handle.dispose()
  })

  it('dedupes the same requestId and gates reply playback on autoSpeak', async () => {
    const stub = createSynthStub()
    const handle = attachTtsPlayback(
      startTtsClient({
        speechSynthesis: stub.synth,
        createUtterance: createPlainUtterance,
        autoSpeak: false,
      }),
    )
    const payload = {
      kind: 'browser-fallback' as const,
      engine: 'speechSynthesis' as const,
      text: '不应自动朗读',
      uiHint: FRIEND_TTS_FALLBACK_UI_HINT,
      reason: 'test',
      source: 'reply' as const,
      requestId: 'req-3',
    }
    await handle.playReady(payload)
    expect(stub.utterances).toHaveLength(0)

    handle.setAutoSpeak(true)
    const first = handle.playReady({ ...payload, requestId: 'req-4', source: 'preview' })
    const second = handle.playReady({ ...payload, requestId: 'req-4', source: 'preview' })
    expect(stub.utterances).toHaveLength(1)
    stub.finishLast()
    await Promise.all([first, second])
    handle.dispose()
  })

  it('preview() POSTs /friend/tts/preview then plays the returned payload', async () => {
    const stub = createSynthStub()
    const calls: Array<{ url: string; method?: string }> = []
    const handle = attachTtsPlayback(
      startTtsClient({
        speechSynthesis: stub.synth,
        createUtterance: createPlainUtterance,
      }),
      {
        fetch: async (url, init) => {
          calls.push({ url, method: init?.method })
          return {
            ok: true,
            status: 200,
            json: async () => ({
              kind: 'browser-fallback',
              engine: 'speechSynthesis',
              text: '你好，这是语音试听。',
              uiHint: FRIEND_TTS_FALLBACK_UI_HINT,
              reason: 'provider set to browser',
              source: 'preview',
              requestId: 'preview-1',
            }),
            arrayBuffer: async () => new ArrayBuffer(0),
          }
        },
      },
    )
    const result = await handle.preview()
    expect(calls[0]).toEqual({ url: '/friend/tts/preview', method: 'POST' })
    expect(result?.kind).toBe('browser-fallback')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(stub.utterances[0]?.text).toBe('你好，这是语音试听。')
    stub.finishLast()
    handle.dispose()
  })
})

describe('energy pump dispatches lipsync', () => {
  it('fires dsh-friend:lipsync from the AudioContext onEnergy path', async () => {
    vi.useFakeTimers()
    const mock = createAudioMock()
    const events: number[] = []
    const target = {
      dispatchEvent(event: Event) {
        const custom = event as CustomEvent<{ level: number }>
        if (custom.type === FRIEND_LIPSYNC_EVENT && typeof custom.detail?.level === 'number') {
          events.push(custom.detail.level)
        }
        return true
      },
    }
    const original = globalThis as typeof globalThis & { dispatchEvent?: (event: Event) => boolean }
    const previous = original.dispatchEvent
    original.dispatchEvent = target.dispatchEvent.bind(target)

    const player = createFriendTtsPlayer({
      audioContext: mock.context,
      onEnergy: (sample) => {
        target.dispatchEvent(new CustomEvent(FRIEND_LIPSYNC_EVENT, { detail: { level: sample.rms } }))
      },
    })
    const playing = player.enqueue({ bytes: new Uint8Array(4) })
    await Promise.resolve()
    vi.advanceTimersByTime(80)
    expect(events.length).toBeGreaterThan(0)
    player.stopAll()
    await playing
    player.dispose()
    if (previous === undefined) {
      delete original.dispatchEvent
    } else {
      original.dispatchEvent = previous
    }
    vi.useRealTimers()
  })
})
