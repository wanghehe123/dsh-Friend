import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFriendSettingsInstallProbe, FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared'

import { createStrictCordisCtx } from '@wish233/dsh-friend-shared'

import { apply, inject, name } from '../src/index.ts'
import {
  apply as applyClient,
  FRIEND_ASR_CLIENT_GLOBAL,
  FRIEND_STAGE_CHAT_PATH,
  startAsrClient,
} from '../src/client.ts'
import { bindAsrSettings, readFriendAsrSettings } from '../src/settings.ts'
import { createFakeEngine } from './helpers/speech-recognition.ts'
import { altS, createHotkeyTarget, keyEvent } from './helpers/keyboard.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete asrClientGlobals()[FRIEND_ASR_CLIENT_GLOBAL]
})

describe('host apply', () => {
  it('registers friend-asr on the production path', () => {
    const probe = createFriendSettingsInstallProbe()
    apply({ ...probe })
    expect(probe.registered.map((item) => item.ns)).toEqual([FRIEND_SETTINGS_NAMESPACES.asr])
  })

  it('emits the smoke mount marker and does not throw', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect(() => apply({})).not.toThrow()
    expect(info).toHaveBeenCalledWith(`dsh-friend:plugin-mount ${name}`)
  })

  it('declares webServer inject and registers the transcribe route', () => {
    expect(inject).toEqual(['webServer', 'settings'])
    const routes: Array<{ kind: string; path: string }> = []
    const effect = vi.fn((execute: () => () => void) => execute())
    apply({
      effect,
      webServer: {
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
    })
    expect(routes.some((route) => route.kind === 'exact' && route.path === '/friend/asr/transcribe')).toBe(true)
  })
})

describe('asr settings namespace', () => {
  it('binds the kebab friend-asr namespace from shared, not a dotted string', () => {
    const bind = vi.fn(() => ({
      getSnapshot: () => ({
        status: 'ready' as const,
        value: { hotkey: 'Alt+S', mode: 'hold' as const, silenceMs: 1200, bargeIn: true, language: 'zh-CN' },
        base: {},
        user: {},
        revision: 1,
        writable: true,
        mode: 'host' as const,
      }),
      subscribe: () => () => {},
      set: vi.fn(),
      unset: vi.fn(),
    }))
    bindAsrSettings({ bind })
    expect(bind).toHaveBeenCalledOnce()
    const spec = bind.mock.calls[0]?.[0]
    expect(spec?.namespace).toBe(FRIEND_SETTINGS_NAMESPACES.asr)
    expect(spec?.namespace).toBe('friend-asr')
    expect(spec?.namespace).not.toMatch(/\./)
  })

  it('fills defaults for a missing document', () => {
    expect(readFriendAsrSettings(undefined).hotkey).toBe('Alt+S')
    expect(readFriendAsrSettings({ hotkey: 'Alt+Q' }).hotkey).toBe('Alt+Q')
  })
})

describe('client wiring', () => {
  it('connects capture-phase Alt+S to the hold session and persists a recorded chord', async () => {
    const fake = createFakeEngine()
    const target = createHotkeyTarget()
    const sent: string[] = []
    const set = vi.fn(async () => {})
    const scope = {
      getSnapshot: () => ({
        status: 'ready' as const,
        value: { hotkey: 'Alt+S', mode: 'hold' as const, silenceMs: 1200, bargeIn: true, language: 'zh-CN' },
        base: {},
        user: {},
        revision: 1,
        writable: true,
        mode: 'memory' as const,
      }),
      subscribe: () => () => {},
      set,
      unset: vi.fn(),
    }
    const handle = startAsrClient({
      engine: fake.engine,
      document: target.target,
      settingsScope: { bind: () => scope },
      onSend: (text) => {
        sent.push(text)
      },
    })

    expect(target.capture.keydown).toBe(true)
    target.dispatch(altS('keydown'))
    expect(fake.starts).toEqual(['hold'])
    fake.emitFinal('今天天气不错')
    target.dispatch(altS('keyup'))
    expect(sent).toEqual(['今天天气不错'])

    handle.hotkey.startRecording()
    handle.hotkey.handleEvent(keyEvent({ type: 'keydown', key: 'q', altKey: true }))
    expect(set).toHaveBeenCalledWith('hotkey', 'Alt+Q')

    handle.dispose()
  })
})

describe('client apply() production send path', () => {
  it('POSTs submitFinal to /friend/stage/chat without an injected onSend', () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = createStrictCordisCtx({
      inject: ['settingsScope'],
      values: {
        settingsScope: {
          bind: () => ({
            getSnapshot: () => ({
              status: 'ready' as const,
              value: { hotkey: 'Alt+S', mode: 'hold' as const, silenceMs: 1200, bargeIn: true, language: 'zh-CN' },
              base: {},
              user: {},
              revision: 1,
              writable: true,
              mode: 'memory' as const,
            }),
            subscribe: () => () => {},
            set: async () => {},
            unset: async () => {},
          }),
        },
      },
    })
    const handle = applyClient(ctx)
    expect(asrClientGlobals()[FRIEND_ASR_CLIENT_GLOBAL]).toBe(handle)

    handle.submitFinal('今天天气不错')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(FRIEND_STAGE_CHAT_PATH)
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '今天天气不错' }),
    })

    handle.dispose()
    expect(asrClientGlobals()[FRIEND_ASR_CLIENT_GLOBAL]).toBeUndefined()
  })
})

function asrClientGlobals(): { [FRIEND_ASR_CLIENT_GLOBAL]?: unknown } {
  return globalThis as typeof globalThis & { [FRIEND_ASR_CLIENT_GLOBAL]?: unknown }
}
