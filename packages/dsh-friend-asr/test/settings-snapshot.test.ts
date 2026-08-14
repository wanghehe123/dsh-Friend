import { describe, expect, it, vi } from 'vitest'

import { startAsrClient } from '../src/browser.ts'
import {
  createSnapshotAsrSettingsBinder,
  FRIEND_ASR_SETTINGS_NAMESPACE,
  FRIEND_SETTINGS_PATCH_PATH,
  FRIEND_SETTINGS_SNAPSHOT_PATH,
} from '../src/settings-snapshot.ts'
import { createSpeechRecognitionWorld } from './helpers/speech-recognition.ts'

function snapshotResponse(asr: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ asr }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('createSnapshotAsrSettingsBinder', () => {
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
})
