import { createStrictCordisCtx } from '@wishp3/dsh-friend-shared'
import { describe, expect, it, vi } from 'vitest'

import { apply, startTtsClient, type FriendTtsClientContext } from '../src/client.ts'
import type {
  FriendAnalyserLike,
  FriendAudioContextLike,
  FriendBufferSourceLike,
  FriendGainLike,
} from '../src/audio-player.ts'
import { createPlainUtterance } from '../src/speech-fallback.ts'
import type { SpeechSynthesisLike, SpeechSynthesisUtteranceLike } from '../src/speech-fallback.ts'
import {
  toClientTtsSnapshot,
  type FriendTtsClientSnapshot,
  type TtsSettingsBinder,
  type TtsSettingsScope,
} from '../src/settings.ts'

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
  const gain: FriendGainLike = { gain: { value: 1 }, connect: vi.fn() }
  const analyser: FriendAnalyserLike = {
    fftSize: 0,
    frequencyBinCount: 128,
    connect: vi.fn(),
    getByteTimeDomainData() {},
  }
  const sources: FriendBufferSourceLike[] = []
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
  return { context, gain, sources }
}

function liveTtsScope(initial: Record<string, unknown> = {}): {
  binder: TtsSettingsBinder
  push(patch: Record<string, unknown>): void
  listenerCount(): number
} {
  let value = toClientTtsSnapshot(initial)
  const listeners = new Set<() => void>()
  const scope: TtsSettingsScope = {
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
      value = toClientTtsSnapshot({ ...value, ...patch })
      for (const listener of listeners) {
        listener()
      }
    },
    listenerCount: () => listeners.size,
  }
}

describe('live TTS playback settings (volume / muted / autoSpeak)', () => {
  it('applies subscribed volume and mute to speechSynthesis and the AudioContext gain', async () => {
    const stub = createSynthStub()
    const mock = createAudioMock()
    const live = liveTtsScope({ volume: 1, muted: false, autoSpeak: true })
    const handle = startTtsClient({
      speechSynthesis: stub.synth,
      createUtterance: createPlainUtterance,
      player: { audioContext: mock.context },
      settingsScope: live.binder,
    })

    const spoken = handle.speak({ text: '初始音量' })
    expect(stub.utterances[0]?.volume).toBe(1)

    const played = handle.player.enqueue({ bytes: new Uint8Array(4) })
    await Promise.resolve()
    await Promise.resolve()
    expect(mock.gain.gain.value).toBe(1)

    live.push({ volume: 0.4 })
    expect(handle.getVolume()).toBe(0.4)
    expect(stub.utterances[0]?.volume).toBe(0.4)
    expect(mock.gain.gain.value).toBe(0.4)

    live.push({ muted: true })
    expect(handle.isMuted()).toBe(true)
    expect(stub.utterances[0]?.volume).toBe(0)
    expect(mock.gain.gain.value).toBe(0)

    stub.finishLast()
    await spoken
    mock.sources[0]?.onended?.()
    await played

    const afterMute = handle.speak({ text: '静音后新一句' })
    expect(stub.utterances.at(-1)?.volume).toBe(0)
    stub.finishLast()
    await afterMute
    handle.dispose()
  })

  it('gates speakReply on autoSpeak but leaves explicit speak() (preview) ungated', async () => {
    const stub = createSynthStub()
    const live = liveTtsScope({ autoSpeak: true, volume: 1, muted: false })
    const handle = startTtsClient({
      speechSynthesis: stub.synth,
      createUtterance: createPlainUtterance,
      settingsScope: live.binder,
    })

    const first = handle.speakReply({ text: '伴侣回复' })
    expect(stub.utterances).toHaveLength(1)
    stub.finishLast()
    await first

    live.push({ autoSpeak: false })
    expect(handle.isAutoSpeak()).toBe(false)
    await handle.speakReply({ text: '关闭后不应合成' })
    expect(stub.utterances).toHaveLength(1)

    const preview = handle.speak({ text: '试听仍应出声' })
    expect(stub.utterances).toHaveLength(2)
    expect(stub.utterances[1]?.text).toBe('试听仍应出声')
    stub.finishLast()
    await preview

    live.push({ autoSpeak: true })
    const resumed = handle.speakReply({ text: '重新开启' })
    expect(stub.utterances).toHaveLength(3)
    expect(stub.utterances[2]?.text).toBe('重新开启')
    stub.finishLast()
    await resumed
    handle.dispose()
  })

  it('unsubscribes on dispose so later setting pushes do not touch a dead handle', async () => {
    const stub = createSynthStub()
    const live = liveTtsScope({ volume: 1, muted: false })
    const handle = startTtsClient({
      speechSynthesis: stub.synth,
      createUtterance: createPlainUtterance,
      settingsScope: live.binder,
    })
    expect(live.listenerCount()).toBe(1)
    handle.dispose()
    expect(live.listenerCount()).toBe(0)
    expect(() => live.push({ volume: 0.1, muted: true })).not.toThrow()
  })
})

describe('apply() live playback on a strict ctx (only settingsScope injected)', () => {
  it('hot-updates volume / muted / autoSpeak without reading browser seams off ctx', () => {
    const live = liveTtsScope({ volume: 1, muted: false, autoSpeak: true })
    const ctx = createStrictCordisCtx({
      inject: ['settingsScope'],
      values: { settingsScope: live.binder },
    })
    expect(() => ctx.speechSynthesis).toThrow(/cannot get property "speechSynthesis" without inject/)
    expect(() => ctx.volume).toThrow(/cannot get property "volume" without inject/)
    expect(() => ctx.muted).toThrow(/cannot get property "muted" without inject/)
    expect(() => ctx.autoSpeak).toThrow(/cannot get property "autoSpeak" without inject/)

    const handle = apply(ctx as FriendTtsClientContext)
    expect(handle.getVolume()).toBe(1)
    expect(handle.isMuted()).toBe(false)
    expect(handle.isAutoSpeak()).toBe(true)

    live.push({ volume: 0.4 })
    expect(handle.getVolume()).toBe(0.4)
    live.push({ muted: true })
    expect(handle.isMuted()).toBe(true)
    live.push({ autoSpeak: false })
    expect(handle.isAutoSpeak()).toBe(false)
    live.push({ muted: false, autoSpeak: true, volume: 0.8 })
    expect(handle.isMuted()).toBe(false)
    expect(handle.isAutoSpeak()).toBe(true)
    expect(handle.getVolume()).toBe(0.8)
    handle.dispose()
  })

  it('throws when apply() reads settingsScope on a ctx that did not inject it', () => {
    const ctx = createStrictCordisCtx({ inject: [] })
    expect(() => apply(ctx as FriendTtsClientContext)).toThrow(
      /cannot get property "settingsScope" without inject/,
    )
  })
})

describe('readTtsPlayback defaults', () => {
  it('treats a missing snapshot as speak-on at full volume', async () => {
    const stub = createSynthStub()
    const handle = startTtsClient({
      speechSynthesis: stub.synth,
      createUtterance: createPlainUtterance,
    })
    expect(handle.getVolume()).toBe(1)
    expect(handle.isMuted()).toBe(false)
    expect(handle.isAutoSpeak()).toBe(true)
    const spoken = handle.speak({ text: '默认' })
    expect(stub.utterances[0]?.volume).toBe(1)
    stub.finishLast()
    await spoken
    handle.dispose()
  })
})

describe('client snapshot still drops secrets when playback fields are present', () => {
  it('keeps volume / muted / autoSpeak on the sanitized view without key material', () => {
    const snapshot: FriendTtsClientSnapshot = toClientTtsSnapshot({
      volume: 0.55,
      muted: true,
      autoSpeak: false,
      openaiApiKey: 'sk-live-CANARY_dsh_friend_tts_key_leak_7f3e9a2c',
    })
    expect(snapshot.volume).toBe(0.55)
    expect(snapshot.muted).toBe(true)
    expect(snapshot.autoSpeak).toBe(false)
    expect(JSON.stringify(snapshot)).not.toContain('sk-live-CANARY')
  })
})
