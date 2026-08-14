import { describe, expect, it } from 'vitest'

import { createStrictCordisCtx } from '@wishp3/dsh-friend-shared'

import {
  apply,
  applyPetPerformance,
  dispatchFriendReaction,
  enqueueReactionTts,
  FRIEND_REACTION_EVENT,
  FRIEND_TTS_CLIENT_GLOBAL,
  FRIEND_TTS_PREVIEW_PATH,
} from '../src/client.ts'

function createTarget() {
  const events: Array<{ type: string; detail?: unknown }> = []
  const posted: unknown[] = []
  const iframeEvents: Array<{ type: string; detail?: unknown }> = []
  const petSnapshots: unknown[] = []
  const iframe = {
    contentWindow: {
      __DSH_FRIEND_PET__: {
        applyPerformance(snapshot: unknown) {
          petSnapshots.push(snapshot)
        },
      },
      dispatchEvent(event: Event) {
        const custom = event as CustomEvent<unknown>
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
      const custom = event as CustomEvent<unknown>
      events.push({ type: custom.type, detail: custom.detail })
      return true
    },
    document: {
      querySelectorAll() {
        return [iframe]
      },
    },
  }
  return { target, events, iframeEvents, posted, petSnapshots }
}

describe('dispatchFriendReaction', () => {
  it('fans dsh-friend:reaction onto the target and same-origin iframes', () => {
    const { target, events, iframeEvents, posted } = createTarget()
    const snapshot = { kind: 'turn-start', expression: 'neutral', motionGroup: 'Thinking' }
    dispatchFriendReaction(snapshot, target)
    expect(events).toEqual([{ type: FRIEND_REACTION_EVENT, detail: snapshot }])
    expect(iframeEvents).toEqual([{ type: FRIEND_REACTION_EVENT, detail: snapshot }])
    expect(posted).toEqual([{ type: FRIEND_REACTION_EVENT, snapshot }])
  })
})

describe('applyPetPerformance', () => {
  it('calls applyPerformance on the pet living in a same-origin iframe', () => {
    const { target, petSnapshots } = createTarget()
    const snapshot = { expression: 'happy', motionGroup: 'Celebrate' }
    expect(applyPetPerformance(snapshot, target)).toBe(true)
    expect(petSnapshots).toEqual([snapshot])
  })
})

describe('client apply consumes SSE and presents', () => {
  it('applies iframe pet performance and dispatches dsh-friend:reaction from the SSE path', () => {
    const { target, events, petSnapshots } = createTarget()
    const listeners: Array<(event: { data: string }) => void> = []
    class FakeSource {
      addEventListener(type: string, listener: (event: { data: string }) => void) {
        if (type === 'reaction') {
          listeners.push(listener)
        }
      }
      close() {}
    }
    const ctx = createStrictCordisCtx({
      inject: [],
      values: {
        effect(execute: () => () => void) {
          execute()
        },
      },
    })
    apply(ctx as { effect?: (execute: () => () => void, label?: string) => void }, {
      EventSource: FakeSource,
      target,
    })
    const snapshot = {
      kind: 'turn-start',
      expression: 'neutral',
      motionGroup: 'Thinking',
      level: 'action',
    }
    listeners[0]?.({ data: JSON.stringify({ type: 'reaction', payload: snapshot }) })
    expect(petSnapshots).toEqual([snapshot])
    expect(events).toContainEqual({ type: FRIEND_REACTION_EVENT, detail: snapshot })
  })
})

describe('enqueueReactionTts', () => {
  it('prefers window.__DSH_FRIEND_TTS__.preview', () => {
    const spoken: string[] = []
    const bag = globalThis as typeof globalThis & { [FRIEND_TTS_CLIENT_GLOBAL]?: { preview: (text: string) => void } }
    const previous = bag[FRIEND_TTS_CLIENT_GLOBAL]
    bag[FRIEND_TTS_CLIENT_GLOBAL] = {
      preview(text) {
        spoken.push(text)
      },
    }
    enqueueReactionTts('做成了！')
    expect(spoken).toEqual(['做成了！'])
    if (previous === undefined) {
      delete bag[FRIEND_TTS_CLIENT_GLOBAL]
    } else {
      bag[FRIEND_TTS_CLIENT_GLOBAL] = previous
    }
  })

  it('falls back to POST /friend/tts/preview when the TTS global is missing', () => {
    const calls: Array<{ url: string; method?: string }> = []
    enqueueReactionTts('漂亮，这一轮干净。', {
      fetch: async (url, init) => {
        calls.push({ url, method: init?.method })
        return {}
      },
    })
    expect(calls).toEqual([{ url: FRIEND_TTS_PREVIEW_PATH, method: 'POST' }])
  })
})
