import { describe, expect, it } from 'vitest'

import { startTtsClient, stopAllFriendTts } from '../src/client.ts'
import {
  FRIEND_TTS_FALLBACK_UI_HINT,
  FRIEND_TTS_FALLBACK_UI_LABEL,
  createBrowserFallbackInstruction,
  fallbackUiLabel,
} from '../src/providers/browser.ts'
import {
  createPlainUtterance,
  createSpeechFallbackExecutor,
  mapPitchToSpeech,
  mapRateToSpeech,
  pickSpeechVoice,
  type SpeechSynthesisLike,
  type SpeechSynthesisUtteranceLike,
  type SpeechSynthesisVoiceLike,
} from '../src/speech-fallback.ts'

function voice(overrides: Partial<SpeechSynthesisVoiceLike> = {}): SpeechSynthesisVoiceLike {
  return {
    voiceURI: 'zh-CN-Tingting',
    name: 'Tingting',
    lang: 'zh-CN',
    localService: true,
    default: true,
    ...overrides,
  }
}

function createSynthStub(voices: SpeechSynthesisVoiceLike[] = [voice()]) {
  const utterances: SpeechSynthesisUtteranceLike[] = []
  let speaking = false
  let cancelCount = 0
  const synth: SpeechSynthesisLike = {
    get speaking() {
      return speaking
    },
    pending: false,
    paused: false,
    getVoices: () => voices,
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
  return {
    synth,
    utterances,
    cancelCount: () => cancelCount,
    finishLast() {
      const last = utterances.at(-1)
      speaking = false
      last?.onend?.({})
    },
  }
}

describe('browser speechSynthesis executor', () => {
  it('maps voice / rate / pitch onto SpeechSynthesisUtterance', async () => {
    const stub = createSynthStub([
      voice(),
      voice({ name: 'Xiaoxiao', voiceURI: 'zh-CN-XiaoxiaoNeural', lang: 'zh-CN', default: false }),
    ])
    const executor = createSpeechFallbackExecutor({
      speechSynthesis: stub.synth,
      createUtterance: createPlainUtterance,
    })
    const spoken = executor.speak({
      text: '你好呀',
      voice: 'zh-CN-XiaoxiaoNeural',
      rate: 1.4,
      pitch: 0.8,
      uiHint: FRIEND_TTS_FALLBACK_UI_HINT,
    })

    expect(stub.utterances).toHaveLength(1)
    const utterance = stub.utterances[0]
    expect(utterance?.text).toBe('你好呀')
    expect(utterance?.rate).toBe(1.4)
    expect(utterance?.pitch).toBe(0.8)
    expect(utterance?.voice?.voiceURI).toBe('zh-CN-XiaoxiaoNeural')
    expect(executor.getUiHint()).toBe('fallback')
    expect(executor.getUiLabel()).toBe(FRIEND_TTS_FALLBACK_UI_LABEL)
    expect(fallbackUiLabel({ uiHint: 'fallback' })).toBe('兜底中')

    stub.finishLast()
    await spoken
    expect(executor.getUiHint()).toBeUndefined()
    executor.dispose()
  })

  it('stopAll() cancels speechSynthesis, clears the queue, and unblocks speak()', async () => {
    const stub = createSynthStub()
    const hints: Array<string | undefined> = []
    const executor = createSpeechFallbackExecutor({
      speechSynthesis: stub.synth,
      createUtterance: createPlainUtterance,
      onUiHint: (hint) => {
        hints.push(hint)
      },
    })

    const first = executor.speak(createBrowserFallbackInstruction('第一句', {}, 'test'))
    const second = executor.speak(createBrowserFallbackInstruction('第二句', {}, 'test'))
    expect(stub.utterances).toHaveLength(1)
    expect(executor.getUiHint()).toBe('fallback')

    executor.stopAll()
    expect(stub.cancelCount()).toBe(1)
    expect(executor.getUiHint()).toBeUndefined()
    await Promise.all([first, second])

    const after = executor.speak(createBrowserFallbackInstruction('第三句', {}, 'test'))
    expect(stub.utterances.at(-1)?.text).toBe('第三句')
    stub.finishLast()
    await after
    expect(hints).toContain('fallback')
    expect(hints.at(-1)).toBeUndefined()
    executor.dispose()
  })

  it('exposes stopAll() on the startTtsClient handle and via stopAllFriendTts()', async () => {
    const stub = createSynthStub()
    const handle = startTtsClient({
      speechSynthesis: stub.synth,
      createUtterance: createPlainUtterance,
    })
    const pending = handle.speak(createBrowserFallbackInstruction('打断我', { rate: 1 }, 'forced'))
    expect(typeof handle.stopAll).toBe('function')
    stopAllFriendTts()
    await pending
    expect(stub.cancelCount()).toBe(1)
    handle.dispose()
  })

  it('startTtsClient replaces the previous handle used by stopAllFriendTts', async () => {
    const firstStub = createSynthStub()
    const first = startTtsClient({
      speechSynthesis: firstStub.synth,
      createUtterance: createPlainUtterance,
    })
    const pending = first.speak(createBrowserFallbackInstruction('旧', {}, 'x'))
    const secondStub = createSynthStub()
    const second = startTtsClient({
      speechSynthesis: secondStub.synth,
      createUtterance: createPlainUtterance,
    })
    await pending
    expect(firstStub.cancelCount()).toBe(1)
    const next = second.speak(createBrowserFallbackInstruction('新', {}, 'x'))
    stopAllFriendTts()
    await next
    expect(secondStub.cancelCount()).toBe(1)
    second.dispose()
  })

  it('clamps utterance rate/pitch and matches voices by name or URI', () => {
    expect(mapRateToSpeech(undefined)).toBe(1)
    expect(mapRateToSpeech(99)).toBe(10)
    expect(mapRateToSpeech(0)).toBe(0.1)
    expect(mapPitchToSpeech(3)).toBe(2)
    expect(mapPitchToSpeech(-1)).toBe(0)

    const voices = [
      voice({ name: 'Aria', voiceURI: 'en-US-AriaNeural', lang: 'en-US', default: false }),
      voice(),
    ]
    expect(pickSpeechVoice(voices, 'Aria')?.name).toBe('Aria')
    expect(pickSpeechVoice(voices, 'zh-CN-Tingting')?.name).toBe('Tingting')
    expect(pickSpeechVoice(voices, 'zh-CN')?.lang).toBe('zh-CN')
  })

  it('resolves speak() immediately when speechSynthesis is missing', async () => {
    const executor = createSpeechFallbackExecutor({
      createUtterance: createPlainUtterance,
    })
    await expect(executor.speak(createBrowserFallbackInstruction('无引擎', {}, 'none'))).resolves.toBeUndefined()
    executor.dispose()
  })
})

describe('stopAll public signature (W-M3-4 hook)', () => {
  it('is a zero-arg void function on the handle', () => {
    const stub = createSynthStub()
    const handle = createSpeechFallbackExecutor({
      speechSynthesis: stub.synth,
      createUtterance: createPlainUtterance,
    })
    const stopAll: () => void = handle.stopAll
    expect(stopAll.length).toBe(0)
    expect(stopAll()).toBeUndefined()
    handle.dispose()
  })
})
