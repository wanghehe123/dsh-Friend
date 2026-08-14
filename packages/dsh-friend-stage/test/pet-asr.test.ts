import { describe, expect, it, vi } from 'vitest'

import {
  FRIEND_ASR_FACTORY_GLOBAL,
  FRIEND_ASR_FACTORY_READY_EVENT,
  FRIEND_ASR_GLOBAL,
  FRIEND_SHELL_TALK_EVENT,
  FRIEND_VOICE_BUTTON_ID,
  mountPetAsrClient,
  type PetAsrFactory,
  type PetAsrHandle,
} from '../src/pet-asr.ts'

type TalkDetail = { phase: 'pressed' | 'released'; mode?: string }

function createPetDom() {
  const listeners = new Map<string, Array<(event: Event) => void>>()
  const voiceListeners = new Map<string, Array<(event: Event) => void>>()
  const voice = {
    id: FRIEND_VOICE_BUTTON_ID,
    hidden: true,
    addEventListener(type: string, listener: (event: Event) => void) {
      const list = voiceListeners.get(type) ?? []
      list.push(listener)
      voiceListeners.set(type, list)
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      const list = voiceListeners.get(type)
      if (list === undefined) return
      voiceListeners.set(type, list.filter((item) => item !== listener))
    },
    dispatch(type: string) {
      for (const listener of voiceListeners.get(type) ?? []) listener(new Event(type))
    },
  }
  const documentLike = {
    getElementById(id: string) {
      return id === FRIEND_VOICE_BUTTON_ID ? voice : null
    },
  }
  const windowLike = {
    [FRIEND_ASR_GLOBAL]: undefined as PetAsrHandle | undefined,
    [FRIEND_ASR_FACTORY_GLOBAL]: undefined as PetAsrFactory | undefined,
    addEventListener(type: string, listener: (event: Event) => void) {
      const list = listeners.get(type) ?? []
      list.push(listener)
      listeners.set(type, list)
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      const list = listeners.get(type)
      if (list === undefined) return
      listeners.set(type, list.filter((item) => item !== listener))
    },
    dispatchEvent(event: Event) {
      for (const listener of listeners.get(event.type) ?? []) listener(event)
      return true
    },
  }
  return { documentLike, windowLike, voice, listeners }
}

describe('pet page ASR client mount', () => {
  it('starts an injected factory, exposes the handle, and maps shell-talk to session.dispatch', () => {
    const { documentLike, windowLike, voice } = createPetDom()
    const dispatched: string[] = []
    const factory: PetAsrFactory = () => ({
      session: {
        dispatch(event) {
          dispatched.push(event.type)
          return []
        },
      },
      dispose: vi.fn(),
    })

    const mounted = mountPetAsrClient({
      window: windowLike,
      document: documentLike,
      factory,
      onSend: vi.fn(),
    })

    expect(windowLike[FRIEND_ASR_GLOBAL]?.session).toBe(mounted.handle?.session)
    expect(voice.hidden).toBe(false)

    windowLike.dispatchEvent(new CustomEvent(FRIEND_SHELL_TALK_EVENT, {
      detail: { phase: 'pressed', mode: 'hold' } satisfies TalkDetail,
    }))
    windowLike.dispatchEvent(new CustomEvent(FRIEND_SHELL_TALK_EVENT, {
      detail: { phase: 'released', mode: 'hold' } satisfies TalkDetail,
    }))
    expect(dispatched).toEqual(['hotkey-down', 'hotkey-up'])

    voice.dispatch('pointerdown')
    voice.dispatch('pointerup')
    expect(dispatched).toEqual(['hotkey-down', 'hotkey-up', 'hotkey-down', 'hotkey-up'])

    mounted.dispose()
    expect(windowLike[FRIEND_ASR_GLOBAL]).toBeUndefined()
  })

  it('adopts a late factory announced on the ready event', () => {
    const { documentLike, windowLike } = createPetDom()
    const dispatched: string[] = []
    const mounted = mountPetAsrClient({
      window: windowLike,
      document: documentLike,
    })
    expect(mounted.handle).toBeUndefined()

    windowLike[FRIEND_ASR_FACTORY_GLOBAL] = () => ({
      session: {
        dispatch(event) {
          dispatched.push(event.type)
          return []
        },
      },
      dispose() {},
    })
    windowLike.dispatchEvent(new Event(FRIEND_ASR_FACTORY_READY_EVENT))
    expect(windowLike[FRIEND_ASR_GLOBAL]).toBeDefined()

    windowLike.dispatchEvent(new CustomEvent(FRIEND_SHELL_TALK_EVENT, {
      detail: { phase: 'pressed' } satisfies TalkDetail,
    }))
    expect(dispatched).toEqual(['hotkey-down'])
    mounted.dispose()
  })
})
