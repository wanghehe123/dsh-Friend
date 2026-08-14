import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createSnapshotAsrSettingsBinder,
  startAsrClient,
  type EndpointGlobals,
  type FriendAsrBrowserGlobals,
} from '@wish233/dsh-friend-asr/browser'

import {
  FRIEND_ASR_GLOBAL,
  FRIEND_SHELL_TALK_EVENT,
  FRIEND_VOICE_BUTTON_ID,
  PET_STAGE_CHAT_PATH,
  mountPetAsrClient,
  postPetStageChat,
  type PetAsrFactory,
  type PetAsrHandle,
} from '../src/pet-asr.ts'

type TalkDetail = { phase: 'pressed' | 'released'; mode?: string }

type SpeechLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  started: boolean
  onresult: ((event: { resultIndex?: number; results: Array<{ isFinal: boolean; 0?: { transcript: string } }> }) => void) | null
  start(): void
  stop(): void
  abort(): void
  emitFinal(text: string): void
}

type RecorderLike = {
  state: string
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: ((event: { error?: { message?: string } }) => void) | null
  start(): void
  stop(): void
}

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
  return { documentLike, windowLike, voice }
}

function createSpeechWorld(): {
  globals: FriendAsrBrowserGlobals
  instances: SpeechLike[]
  last(): SpeechLike
} {
  const instances: SpeechLike[] = []
  function SpeechRecognition(): SpeechLike {
    const instance: SpeechLike = {
      continuous: false,
      interimResults: false,
      lang: '',
      started: false,
      onresult: null,
      start() {
        this.started = true
      },
      stop() {
        this.started = false
      },
      abort() {
        this.started = false
      },
      emitFinal(text: string) {
        this.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript: text } }],
        })
      },
    }
    instances.push(instance)
    return instance
  }
  return {
    globals: {
      SpeechRecognition: SpeechRecognition as unknown as FriendAsrBrowserGlobals['SpeechRecognition'],
      navigator: { userAgent: 'Mozilla/5.0 Chrome/120.0.0.0' },
    },
    instances,
    last() {
      const instance = instances.at(-1)
      if (instance === undefined) {
        throw new Error('SpeechRecognition was not constructed')
      }
      return instance
    },
  }
}

function createEndpointWorld(): {
  globals: EndpointGlobals
  recorders: RecorderLike[]
} {
  const recorders: RecorderLike[] = []
  class FakeRecorder implements RecorderLike {
    ondataavailable: RecorderLike['ondataavailable'] = null
    onstop: RecorderLike['onstop'] = null
    onerror: RecorderLike['onerror'] = null
    state = 'inactive'
    start() {
      this.state = 'recording'
    }
    stop() {
      this.state = 'inactive'
      this.ondataavailable?.({ data: new Blob([new Uint8Array([1])], { type: 'audio/webm' }) })
      this.onstop?.()
    }
  }
  return {
    globals: {
      MediaRecorder: function Wrapped() {
        const instance = new FakeRecorder()
        recorders.push(instance)
        return instance
      } as unknown as EndpointGlobals['MediaRecorder'],
      navigator: {
        mediaDevices: {
          async getUserMedia() {
            return { getTracks: () => [{ stop: vi.fn() }] }
          },
        },
      },
    },
    recorders,
  }
}

function chatFetchMock() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe(PET_STAGE_CHAT_PATH)
    expect(init?.method).toBe('POST')
    return new Response('{}', { status: 200 })
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pet page ASR live factory (Chromium vs shell)', () => {
  it('Chromium: auto picks webspeech, #friend-voice enters listening, onSend POSTs /friend/stage/chat', () => {
    const { documentLike, windowLike, voice } = createPetDom()
    const speech = createSpeechWorld()
    const chatFetch = chatFetchMock()
    const handle = startAsrClient({
      window: speech.globals,
      endpointGlobals: {},
      onSend: (text) => {
        postPetStageChat(text, chatFetch as unknown as typeof fetch)
      },
    })
    expect(handle.engine.capabilities().engineId).toBe('webspeech')

    const factory: PetAsrFactory = () => handle
    const mounted = mountPetAsrClient({
      window: windowLike,
      document: documentLike,
      factory,
      onSend: (text) => {
        postPetStageChat(text, chatFetch as unknown as typeof fetch)
      },
    })
    expect(windowLike[FRIEND_ASR_GLOBAL]).toBe(handle)
    expect(voice.hidden).toBe(false)

    voice.dispatch('pointerdown')
    expect(handle.session.getState().phase).toBe('listening')
    expect(speech.last().started).toBe(true)

    speech.last().emitFinal('你好伙伴')
    voice.dispatch('pointerup')
    expect(handle.session.getState().phase).toBe('idle')
    expect(chatFetch).toHaveBeenCalledOnce()
    expect(chatFetch.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '你好伙伴' }),
    })
    mounted.dispose()
  })

  it('shell (no SpeechRecognition): auto falls back to endpoint, talk(pressed) is hotkey-down, onSend POSTs chat', async () => {
    const { documentLike, windowLike } = createPetDom()
    const endpoint = createEndpointWorld()
    const chatFetch = chatFetchMock()
    const transcribe = vi.fn(async () => {
      return new Response(JSON.stringify({ text: '壳内说的话' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const noSpeech = { navigator: { userAgent: 'Mozilla/5.0 Tauri/2.0 dsh-friend-shell' } }
    const handle = startAsrClient({
      window: noSpeech,
      endpointGlobals: endpoint.globals,
      fetch: transcribe as unknown as typeof fetch,
      onSend: (text) => {
        postPetStageChat(text, chatFetch as unknown as typeof fetch)
      },
    })
    expect(handle.engine.capabilities().available).toBe(true)
    expect(handle.engine.capabilities().engineId).toBe('endpoint')

    const mounted = mountPetAsrClient({
      window: windowLike,
      document: documentLike,
      factory: () => handle,
    })

    windowLike.dispatchEvent(new CustomEvent(FRIEND_SHELL_TALK_EVENT, {
      detail: { phase: 'pressed', mode: 'hold' } satisfies TalkDetail,
    }))
    expect(handle.session.getState().phase).toBe('listening')
    await vi.waitFor(() => {
      expect(endpoint.recorders).toHaveLength(1)
    })
    expect(endpoint.recorders[0]?.state).toBe('recording')

    windowLike.dispatchEvent(new CustomEvent(FRIEND_SHELL_TALK_EVENT, {
      detail: { phase: 'released', mode: 'hold' } satisfies TalkDetail,
    }))
    await vi.waitFor(() => {
      expect(chatFetch).toHaveBeenCalledOnce()
    })
    expect(String(chatFetch.mock.calls[0]?.[0])).toBe(PET_STAGE_CHAT_PATH)
    expect(chatFetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ text: '壳内说的话' }),
    })
    expect(handle.session.getState().phase).toBe('idle')
    mounted.dispose()
  })

  it('production factory shape: snapshot settingsScope makes hotkey/language live', async () => {
    const { documentLike, windowLike } = createPetDom()
    const speech = createSpeechWorld()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/friend/settings/snapshot') {
        return new Response(JSON.stringify({
          asr: { hotkey: 'Alt+S', language: 'zh-CN', mode: 'hold', engine: 'webspeech' },
        }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
    const handle = startAsrClient({
      window: speech.globals,
      endpointGlobals: {},
      settingsScope: createSnapshotAsrSettingsBinder({
        fetch: fetchMock as unknown as typeof fetch,
        pollMs: 0,
      }),
    })
    const mounted = mountPetAsrClient({
      window: windowLike,
      document: documentLike,
      factory: () => handle,
    })
    await vi.waitFor(() => {
      expect(handle.hotkey.getSpec()).toBe('Alt+S')
      expect(handle.getLanguage()).toBe('zh-CN')
    })
    const before = { hotkey: handle.hotkey.getSpec(), language: handle.getLanguage() }
    await handle.settings?.set('hotkey', 'Alt+Q')
    await handle.settings?.set('language', 'en-US')
    const after = { hotkey: handle.hotkey.getSpec(), language: handle.getLanguage() }
    expect(before).toEqual({ hotkey: 'Alt+S', language: 'zh-CN' })
    expect(after).toEqual({ hotkey: 'Alt+Q', language: 'en-US' })
    mounted.dispose()
  })
})

