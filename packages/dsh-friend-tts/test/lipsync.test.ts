import { describe, expect, it, vi } from 'vitest'

import {
  FRIEND_FALLBACK_LIPSYNC_BOUNDARY,
  createFallbackLipsyncDriver,
} from '../src/fallback-lipsync.ts'
import { FRIEND_LIPSYNC_EVENT, FRIEND_LIPSYNC_LOG_GLOBAL, dispatchFriendLipsync } from '../src/lipsync.ts'
import { startTtsClient } from '../src/speech-fallback.ts'

function createTarget() {
  const events: Array<{ type: string; detail?: { level: number } }> = []
  const posted: unknown[] = []
  const iframeEvents: Array<{ type: string; detail?: { level: number } }> = []
  const iframe = {
    contentWindow: {
      dispatchEvent(event: Event) {
        const custom = event as CustomEvent<{ level: number }>
        iframeEvents.push({ type: custom.type, detail: custom.detail })
        return true
      },
      postMessage(data: unknown) {
        posted.push(data)
      },
    },
  }
  const target = {
    dispatchEvent(event: Event) {
      const custom = event as CustomEvent<{ level: number }>
      events.push({ type: custom.type, detail: custom.detail })
      return true
    },
    document: {
      querySelectorAll() {
        return [iframe]
      },
    },
  }
  return { target, events, iframeEvents, posted }
}

describe('dispatchFriendLipsync', () => {
  it('dispatches dsh-friend:lipsync on the target and same-origin iframes', () => {
    const { target, events, iframeEvents, posted } = createTarget()
    dispatchFriendLipsync(0.42, target)
    expect(events).toEqual([{ type: FRIEND_LIPSYNC_EVENT, detail: { level: 0.42 } }])
    expect(iframeEvents).toEqual([{ type: FRIEND_LIPSYNC_EVENT, detail: { level: 0.42 } }])
    expect(posted).toEqual([{ type: FRIEND_LIPSYNC_EVENT, level: 0.42 }])
    expect((target as { [FRIEND_LIPSYNC_LOG_GLOBAL]?: number[] })[FRIEND_LIPSYNC_LOG_GLOBAL]).toEqual([0.42])
  })

  it('clamps out-of-range levels', () => {
    const { target, events } = createTarget()
    dispatchFriendLipsync(4, target)
    dispatchFriendLipsync(-1, target)
    expect(events[0]?.detail?.level).toBe(1)
    expect(events[1]?.detail?.level).toBe(0)
  })
})

describe('startTtsClient wires lipsync onto speechSynthesis', () => {
  it('pulses dsh-friend:lipsync while a fallback utterance is speaking', async () => {
    vi.useFakeTimers()
    const levels: number[] = []
    const target = {
      dispatchEvent(event: Event) {
        const custom = event as CustomEvent<{ level: number }>
        if (custom.type === FRIEND_LIPSYNC_EVENT && typeof custom.detail?.level === 'number') {
          levels.push(custom.detail.level)
        }
        return true
      },
    }
    const bag = globalThis as typeof globalThis & { dispatchEvent?: (event: Event) => boolean }
    const previous = bag.dispatchEvent
    bag.dispatchEvent = target.dispatchEvent

    const utterances: Array<{ onend: ((event: unknown) => void) | null; onboundary: ((event: unknown) => void) | null }> = []
    let speaking = false
    const handle = startTtsClient({
      createUtterance: (text) => {
        const utterance = {
          text,
          lang: '',
          voice: null,
          volume: 1,
          rate: 1,
          pitch: 1,
          onend: null,
          onerror: null,
          onboundary: null,
        }
        return utterance
      },
      speechSynthesis: {
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
      },
    })
    const spoken = handle.speak({ text: '你好呀' })
    vi.advanceTimersByTime(450)
    expect(levels.some((level) => level > 0.2)).toBe(true)
    utterances[0]?.onboundary?.({ name: 'word', utterance: utterances[0] })
    expect(levels.at(-1)).toBe(FRIEND_FALLBACK_LIPSYNC_BOUNDARY)
    speaking = false
    utterances[0]?.onend?.({})
    await spoken
    handle.dispose()
    if (previous === undefined) {
      delete bag.dispatchEvent
    } else {
      bag.dispatchEvent = previous
    }
    vi.useRealTimers()
  })
})

describe('fallback lipsync envelope', () => {
  it('pulses while speaking, spikes on boundary, and closes on stop', () => {
    vi.useFakeTimers()
    const levels: number[] = []
    const driver = createFallbackLipsyncDriver({
      dispatch: (level) => {
        levels.push(level)
      },
    })
    driver.start('你好，这是语音试听。', 1)
    vi.advanceTimersByTime(450)
    expect(levels.length).toBeGreaterThanOrEqual(2)
    expect(levels.some((level) => level > 0.2)).toBe(true)
    driver.onBoundary()
    expect(levels.at(-1)).toBe(FRIEND_FALLBACK_LIPSYNC_BOUNDARY)
    driver.stop()
    expect(levels.at(-1)).toBe(0)
    vi.useRealTimers()
  })
})
