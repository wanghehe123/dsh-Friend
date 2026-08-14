import { afterEach, describe, expect, it, vi } from 'vitest'

import { startAsrClient } from '../src/browser.ts'
import {
  createSnapshotAsrSettingsBinder,
  FRIEND_ASR_SETTINGS_NAMESPACE,
  FRIEND_SETTINGS_PATCH_PATH,
  FRIEND_SETTINGS_SNAPSHOT_PATH,
} from '../src/settings-snapshot.ts'
import { readFriendAsrSettings } from '../src/settings.ts'
import { createSpeechRecognitionWorld } from './helpers/speech-recognition.ts'

function snapshotResponse(asr: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ asr }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('createSnapshotAsrSettingsBinder', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('applies hotkey and language from GET /friend/settings/snapshot', async () => {
    const fetchMock = vi.fn(async () => snapshotResponse({
      hotkey: 'Alt+Q',
      language: 'en-US',
      mode: 'toggle',
      engine: 'webspeech',
    }))
    const world = createSpeechRecognitionWorld()
    const handle = startAsrClient({
      window: world.globals,
      settingsScope: createSnapshotAsrSettingsBinder({ fetch: fetchMock, pollMs: 0 }),
    })

    expect(fetchMock).toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(FRIEND_SETTINGS_SNAPSHOT_PATH)

    await vi.waitFor(() => {
      expect(handle.hotkey.getSpec()).toBe('Alt+Q')
      expect(handle.getLanguage()).toBe('en-US')
    })
    expect(handle.session.getState().mode).toBe('toggle')
    handle.dispose()
  })

  it('set() updates live hotkey and language (before / after)', async () => {
    const fetchMock = vi.fn(async () => snapshotResponse({
      hotkey: 'Alt+S',
      language: 'zh-CN',
      mode: 'hold',
    }))
    const world = createSpeechRecognitionWorld()
    const handle = startAsrClient({
      window: world.globals,
      settingsScope: createSnapshotAsrSettingsBinder({ fetch: fetchMock, pollMs: 0 }),
    })
    await vi.waitFor(() => {
      expect(handle.hotkey.getSpec()).toBe('Alt+S')
    })

    const before = {
      hotkey: handle.hotkey.getSpec(),
      language: handle.getLanguage(),
    }
    await handle.settings?.set('hotkey', 'Alt+Q')
    await handle.settings?.set('language', 'en-US')
    const after = {
      hotkey: handle.hotkey.getSpec(),
      language: handle.getLanguage(),
    }

    expect(before).toEqual({ hotkey: 'Alt+S', language: 'zh-CN' })
    expect(after).toEqual({ hotkey: 'Alt+Q', language: 'en-US' })

    const posts = fetchMock.mock.calls.filter((call) => {
      const init = call[1] as RequestInit | undefined
      return init?.method === 'POST'
    })
    const bodies = posts.map((call) => String((call[1] as RequestInit | undefined)?.body ?? ''))
    expect(posts.length).toBeGreaterThanOrEqual(2)
    expect(posts.every((call) => String(call[0]) === FRIEND_SETTINGS_PATCH_PATH)).toBe(true)
    expect(posts[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    expect(bodies).toContain(JSON.stringify({
      namespace: FRIEND_ASR_SETTINGS_NAMESPACE,
      patch: { hotkey: 'Alt+Q' },
    }))
    expect(bodies).toContain(JSON.stringify({
      namespace: FRIEND_ASR_SETTINGS_NAMESPACE,
      patch: { language: 'en-US' },
    }))

    handle.session.dispatch({ type: 'hotkey-down' })
    expect(world.last().lang).toBe('en-US')
    handle.session.dispatch({ type: 'hotkey-up' })
    handle.dispose()
  })

  it('applies an external snapshot change when pollMs is set', async () => {
    let hotkey = 'Alt+S'
    const fetchMock = vi.fn(async () => snapshotResponse({
      hotkey,
      language: 'zh-CN',
      mode: 'hold',
    }))
    const world = createSpeechRecognitionWorld()
    const handle = startAsrClient({
      window: world.globals,
      settingsScope: createSnapshotAsrSettingsBinder({ fetch: fetchMock, pollMs: 40 }),
    })
    await vi.waitFor(() => {
      expect(handle.hotkey.getSpec()).toBe('Alt+S')
    })
    hotkey = 'Alt+Q'
    await vi.waitFor(() => {
      expect(handle.hotkey.getSpec()).toBe('Alt+Q')
    })
    handle.dispose()
  })

  it('ignores an older GET that resolves after a newer poll and stops polling on dispose', async () => {
    vi.useFakeTimers()
    const first = deferred<Response>()
    const second = deferred<Response>()
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementation(async () => snapshotResponse({ hotkey: 'Alt+X' }))
    const scope = createSnapshotAsrSettingsBinder({ fetch: fetchMock, pollMs: 40 }).bind({
      namespace: FRIEND_ASR_SETTINGS_NAMESPACE,
      decode: readFriendAsrSettings,
    })
    const unsubscribe = scope.subscribe(() => {})

    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(40)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    second.resolve(snapshotResponse({ hotkey: 'Alt+X' }))
    await flushPromises()
    expect(scope.getSnapshot().value?.hotkey).toBe('Alt+X')

    first.resolve(snapshotResponse({ hotkey: 'Alt+Q' }))
    await flushPromises()
    expect(scope.getSnapshot().value?.hotkey).toBe('Alt+X')

    const callsBeforeDispose = fetchMock.mock.calls.length
    unsubscribe()
    await vi.advanceTimersByTimeAsync(120)
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeDispose)
  })

  it('does not let polling roll back a local value while its PATCH is pending', async () => {
    vi.useFakeTimers()
    const pendingPatch = deferred<Response>()
    const patchBodies: string[] = []
    let snapshotGets = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        patchBodies.push(String(init.body ?? ''))
        return pendingPatch.promise
      }
      snapshotGets += 1
      return Promise.resolve(snapshotResponse({
        hotkey: 'Alt+S',
        language: 'zh-CN',
        mode: 'hold',
      }))
    })
    const world = createSpeechRecognitionWorld()
    const handle = startAsrClient({
      window: world.globals,
      settingsScope: createSnapshotAsrSettingsBinder({ fetch: fetchMock, pollMs: 40 }),
    })
    await flushPromises()
    expect(handle.hotkey.getSpec()).toBe('Alt+S')

    const write = handle.settings?.set('hotkey', 'Alt+X')
    await flushPromises()
    expect(handle.hotkey.getSpec()).toBe('Alt+X')
    await vi.advanceTimersByTimeAsync(40)
    await flushPromises()

    expect(handle.hotkey.getSpec()).toBe('Alt+X')
    expect(snapshotGets).toBe(1)
    expect(patchBodies).not.toContain(JSON.stringify({
      namespace: FRIEND_ASR_SETTINGS_NAMESPACE,
      patch: { hotkey: 'Alt+S' },
    }))

    pendingPatch.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await write
    await flushPromises()
    handle.dispose()
  })
})

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill
  })
  return { promise, resolve }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
