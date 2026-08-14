import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createFriendSettingsInstallProbe,
  createStrictCordisCtx,
  FRIEND_SETTINGS_NAMESPACES,
} from '@wish233/dsh-friend-shared'

import { apply, inject, name } from '../src/index.ts'
import {
  apply as applyClient,
  ASR_CLIENT_SETTINGS_POLL_MS,
  FRIEND_ASR_CLIENT_GLOBAL,
  FRIEND_STAGE_CHAT_PATH,
  resetFriendStageChatDedupe,
  startAsrClient,
} from '../src/client.ts'
import {
  bindAsrSettings,
  readFriendAsrSettings,
  type AsrSettingsBinder,
  type AsrSettingsScope,
  type FriendAsrSettings,
} from '../src/settings.ts'
import { createFakeEngine } from './helpers/speech-recognition.ts'
import { altS, createHotkeyTarget, keyEvent } from './helpers/keyboard.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetFriendStageChatDedupe()
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
  it('hydrates the hotkey from the host snapshot when the injected settings scope is unavailable', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/friend/settings/snapshot') {
        return new Response(JSON.stringify({
          asr: {
            hotkey: 'Alt+X',
            mode: 'hold',
            silenceMs: 1200,
            bargeIn: true,
            language: 'zh-CN',
            engine: 'webspeech',
            autoSend: true,
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = createStrictCordisCtx({
      inject: ['settingsScope'],
      values: {
        settingsScope: {
          bind: () => ({
            getSnapshot: () => ({
              status: 'unavailable' as const,
              value: undefined,
              base: undefined,
              user: undefined,
              revision: undefined,
              writable: true,
              mode: 'host' as const,
            }),
            subscribe: () => () => {},
            set: async () => {},
            unset: async () => {},
          }),
        },
      },
    })

    const handle = applyClient(ctx)

    await vi.waitFor(() => {
      expect(handle.hotkey.getSpec()).toBe('Alt+X')
    })
    expect(fetchMock.mock.calls.some((call) => String(call[0]) === '/friend/settings/snapshot')).toBe(true)
    await handle.settings?.set('language', 'en-US')
    const patchBodies = fetchMock.mock.calls
      .filter((call) => String(call[0]) === '/friend/settings/patch')
      .map((call) => String((call[1] as RequestInit | undefined)?.body ?? ''))
    expect(patchBodies).toContain(JSON.stringify({
      namespace: FRIEND_SETTINGS_NAMESPACES.asr,
      patch: { language: 'en-US' },
    }))
    handle.dispose()
  })

  it('keeps a ready injected scope authoritative without starting snapshot polling', async () => {
    const primary = mutableAsrSettings('ready', { hotkey: 'Alt+Q' })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ asr: { hotkey: 'Alt+X' } }), { status: 200 }))
    const ctx = createStrictCordisCtx({
      inject: ['settingsScope'],
      values: { settingsScope: primary.binder },
    })

    const handle = applyClient(ctx, { fetch: fetchMock })

    expect(handle.hotkey.getSpec()).toBe('Alt+Q')
    expect(fetchMock).not.toHaveBeenCalled()
    await handle.settings?.set('language', 'en-US')
    await handle.settings?.unset('language')
    expect(primary.set).toHaveBeenCalledWith('language', 'en-US')
    expect(primary.unset).toHaveBeenCalledWith('language')
    expect(fetchMock).not.toHaveBeenCalled()
    handle.dispose()
    expect(primary.listenerCount()).toBe(0)
  })

  it('stops and recreates the snapshot fallback as the primary scope changes status', async () => {
    vi.useFakeTimers()
    const primary = mutableAsrSettings('loading')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/friend/settings/snapshot') {
        return new Response(JSON.stringify({
          asr: {
            hotkey: 'Alt+X',
            mode: 'hold',
            silenceMs: 1200,
            bargeIn: true,
            language: 'zh-CN',
            engine: 'webspeech',
            autoSend: true,
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const ctx = createStrictCordisCtx({
      inject: ['settingsScope'],
      values: { settingsScope: primary.binder },
    })

    const handle = applyClient(ctx, { fetch: fetchMock })
    await flushPromises()
    expect(handle.hotkey.getSpec()).toBe('Alt+X')

    primary.push('ready', { hotkey: 'Alt+Q' })
    expect(handle.hotkey.getSpec()).toBe('Alt+Q')
    const getCountWhenReady = snapshotGetCount(fetchMock)
    await vi.advanceTimersByTimeAsync(ASR_CLIENT_SETTINGS_POLL_MS * 3)
    expect(snapshotGetCount(fetchMock)).toBe(getCountWhenReady)

    primary.push('unavailable')
    await flushPromises()
    expect(snapshotGetCount(fetchMock)).toBeGreaterThan(getCountWhenReady)
    expect(handle.hotkey.getSpec()).toBe('Alt+X')

    const getCountBeforeDispose = snapshotGetCount(fetchMock)
    handle.dispose()
    expect(primary.listenerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(ASR_CLIENT_SETTINGS_POLL_MS * 3)
    expect(snapshotGetCount(fetchMock)).toBe(getCountBeforeDispose)
  })

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
    const chatCalls = fetchMock.mock.calls.filter((call) => String(call[0]) === FRIEND_STAGE_CHAT_PATH)
    expect(chatCalls).toHaveLength(1)
    expect(chatCalls[0]?.[1]).toEqual({
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

function mutableAsrSettings(
  initialStatus: ReturnType<AsrSettingsScope['getSnapshot']>['status'],
  initial: Partial<FriendAsrSettings> = {},
): {
  binder: AsrSettingsBinder
  set: ReturnType<typeof vi.fn>
  unset: ReturnType<typeof vi.fn>
  push(status: ReturnType<AsrSettingsScope['getSnapshot']>['status'], patch?: Partial<FriendAsrSettings>): void
  listenerCount(): number
} {
  let status = initialStatus
  let value = readFriendAsrSettings(initial)
  let revision = 1
  const listeners = new Set<() => void>()
  const set = vi.fn(async (field: string, fieldValue: unknown) => {
    value = readFriendAsrSettings({ ...value, [field]: fieldValue })
    revision += 1
  })
  const unset = vi.fn(async (field: string) => {
    const next: Record<string, unknown> = { ...value }
    delete next[field]
    value = readFriendAsrSettings(next)
    revision += 1
  })
  const scope: AsrSettingsScope = {
    getSnapshot: () => ({
      status,
      value: status === 'ready' ? value : undefined,
      base: status === 'ready' ? value : undefined,
      user: status === 'ready' ? value : undefined,
      revision: status === 'ready' ? revision : undefined,
      writable: true,
      mode: 'host',
    }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set,
    unset,
  }
  return {
    binder: { bind: () => scope },
    set,
    unset,
    push(nextStatus, patch = {}) {
      status = nextStatus
      value = readFriendAsrSettings({ ...value, ...patch })
      revision += 1
      for (const listener of listeners) listener()
    },
    listenerCount: () => listeners.size,
  }
}

function snapshotGetCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter((call) => (
    String(call[0]) === '/friend/settings/snapshot'
    && (call[1] as RequestInit | undefined)?.method === 'GET'
  )).length
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
