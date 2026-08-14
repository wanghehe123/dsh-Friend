import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createFriendTtsPlayer,
  detectAudioContainer,
  repairWavHeaders,
  rmsFromTimeDomain,
  sineTimeDomainBytes,
  type FriendAnalyserLike,
  type FriendAudioContextLike,
  type FriendBufferSourceLike,
  type FriendGainLike,
} from '../src/audio-player.ts'
import { stopAllFriendTts } from '../src/stop-all.ts'
import { startTtsClient } from '../src/speech-fallback.ts'
import { createPlainUtterance, type SpeechSynthesisLike, type SpeechSynthesisUtteranceLike } from '../src/speech-fallback.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('audio format helpers (old-repo port)', () => {
  it('detects WAV container from RIFF/WAVE header', () => {
    const wavHeader = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0x24, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45,
    ])
    expect(detectAudioContainer(wavHeader)).toBe('wav')
  })

  it('repairs streaming placeholder WAV data sizes used by cloud TTS', () => {
    const bogus = new Uint8Array(60)
    bogus.set([0x52, 0x49, 0x46, 0x46, 0xff, 0xff, 0xff, 0x7f, 0x57, 0x41, 0x56, 0x45], 0)
    bogus.set([0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00], 12)
    bogus.set([0x64, 0x61, 0x74, 0x61, 0xfb, 0xff, 0xff, 0x7f], 36)

    const repaired = repairWavHeaders(bogus)
    const view = new DataView(repaired.buffer, repaired.byteOffset, repaired.byteLength)
    expect(view.getUint32(4, true)).toBe(repaired.byteLength - 8)
    expect(view.getUint32(40, true)).toBe(repaired.byteLength - 44)
  })
})

describe('energy pump RMS', () => {
  it('outputs a monotonic envelope for a rising sine fixture', () => {
    const samples = [0.2, 0.5, 0.9].map((amplitude) => rmsFromTimeDomain(sineTimeDomainBytes(amplitude)))
    expect(samples[0]).toBeLessThan(samples[1] ?? 0)
    expect(samples[1]).toBeLessThan(samples[2] ?? 0)
  })
})

function createAudioMock() {
  const analyserData: Uint8Array[] = []
  const sources: FriendBufferSourceLike[] = []
  const gain: FriendGainLike = { gain: { value: 1 }, connect: vi.fn() }
  const analyser: FriendAnalyserLike = {
    fftSize: 0,
    frequencyBinCount: 128,
    connect: vi.fn(),
    getByteTimeDomainData(array) {
      const next = analyserData.shift() ?? sineTimeDomainBytes(0.4)
      array.set(next.subarray(0, array.length))
    },
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
  return { context, gain, analyser, sources, analyserData }
}

describe('FriendTtsPlayer queue / first-sound / stopAll', () => {
  it('plays enqueued items in order and starts the first as soon as it decodes', async () => {
    const mock = createAudioMock()
    const started: string[] = []
    mock.context.decodeAudioData = vi.fn(async (buffer) => {
      started.push(String(buffer.byteLength))
      return { duration: 1 }
    })
    const player = createFriendTtsPlayer({ audioContext: mock.context })
    const first = player.enqueue({ id: 'a', bytes: new Uint8Array(8) })
    const second = player.enqueue({ id: 'b', bytes: new Uint8Array(16) })
    await Promise.resolve()
    expect(started).toEqual(['8'])
    expect(player.isPlaying()).toBe(true)
    mock.sources[0]?.onended?.()
    await first
    await Promise.resolve()
    expect(started).toEqual(['8', '16'])
    mock.sources[1]?.onended?.()
    await second
    player.dispose()
  })

  it('stopAll() silences immediately, clears the queue, and applies mute at once', async () => {
    const mock = createAudioMock()
    const player = createFriendTtsPlayer({ audioContext: mock.context, volume: 0.8 })
    const first = player.enqueue({ bytes: new Uint8Array(4) })
    const second = player.enqueue({ bytes: new Uint8Array(4) })
    await Promise.resolve()
    expect(player.queueSize()).toBeGreaterThan(0)
    player.stopAll()
    expect(player.queueSize()).toBe(0)
    expect(player.isPlaying()).toBe(false)
    expect(mock.sources[0]?.stop).toHaveBeenCalled()
    await Promise.all([first, second])
    player.setMuted(true)
    expect(mock.gain.gain.value).toBe(0)
    player.setMuted(false)
    player.setVolume(0.25)
    expect(mock.gain.gain.value).toBe(0.25)
    player.dispose()
  })

  it('samples energy at ~30 Hz while playing', async () => {
    vi.useFakeTimers()
    const mock = createAudioMock()
    mock.analyserData.push(sineTimeDomainBytes(0.2), sineTimeDomainBytes(0.5), sineTimeDomainBytes(0.9))
    const envelope: number[] = []
    const player = createFriendTtsPlayer({
      audioContext: mock.context,
      onEnergy: (sample) => {
        envelope.push(sample.rms)
      },
    })
    const playing = player.enqueue({ bytes: new Uint8Array(4) })
    await Promise.resolve()
    vi.advanceTimersByTime(100)
    expect(envelope.length).toBeGreaterThanOrEqual(3)
    expect(envelope[0] ?? 0).toBeLessThan(envelope[1] ?? 0)
    expect(envelope[1] ?? 0).toBeLessThan(envelope[2] ?? 0)
    player.stopAll()
    await playing
    player.dispose()
  })
})

describe('stopAll facade stops both playback paths', () => {
  it('cancels speechSynthesis and the AudioContext source together', async () => {
    const mock = createAudioMock()
    let speaking = false
    let cancelCount = 0
    const utterances: SpeechSynthesisUtteranceLike[] = []
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
        cancelCount += 1
        speaking = false
      },
      pause() {},
      resume() {},
    }
    const handle = startTtsClient({
      speechSynthesis: synth,
      createUtterance: createPlainUtterance,
      player: { audioContext: mock.context },
    })
    const spoken = handle.speak({ text: 'speech path' })
    const played = handle.player.enqueue({ bytes: new Uint8Array(4) })
    await Promise.resolve()
    stopAllFriendTts()
    expect(cancelCount).toBe(1)
    expect(mock.sources[0]?.stop).toHaveBeenCalled()
    expect(handle.player.queueSize()).toBe(0)
    await Promise.all([spoken, played])
    handle.dispose()
  })
})
