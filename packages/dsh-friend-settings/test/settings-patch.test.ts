import { afterEach, describe, expect, it } from 'vitest'

import { FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared/universal'

import {
  createFriendSettingsPatchWriter,
  readFriendSettingsSnapshot,
} from '../src/client-ui/settings-patch.ts'
import { FRIEND_SETTINGS_PATCH_PATH } from '../src/paths.ts'
import { projectDocuments } from '../src/project.ts'
import { createAsrSectionForm } from '../src/section-forms.ts'

type FetchCall = {
  url: string
  method?: string
  body?: string
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => body,
  } as Response
}

describe('friend settings patch writer', () => {
  const previousFetch = (globalThis as { fetch?: typeof fetch }).fetch

  afterEach(() => {
    if (previousFetch === undefined) {
      delete (globalThis as { fetch?: typeof fetch }).fetch
    } else {
      (globalThis as { fetch: typeof fetch }).fetch = previousFetch
    }
  })

  it('POSTs a single field to /friend/settings/patch', async () => {
    const calls: FetchCall[] = []
    ;(globalThis as { fetch: typeof fetch }).fetch = (async (url, init) => {
      calls.push({
        url: String(url),
        method: init?.method,
        body: typeof init?.body === 'string' ? init.body : undefined,
      })
      return jsonResponse({
        ok: true,
        namespace: FRIEND_SETTINGS_NAMESPACES.asr,
        settings: projectDocuments({
          [FRIEND_SETTINGS_NAMESPACES.asr]: { hotkey: 'Alt+Q' },
        }),
      })
    }) as typeof fetch

    const writer = createFriendSettingsPatchWriter(FRIEND_SETTINGS_NAMESPACES.asr)
    await writer.set('hotkey', 'Alt+Q')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(FRIEND_SETTINGS_PATCH_PATH)
    expect(calls[0]?.method).toBe('POST')
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      namespace: FRIEND_SETTINGS_NAMESPACES.asr,
      patch: { hotkey: 'Alt+Q' },
    })
  })

  it('throws when the host rejects the patch so staged forms stay dirty', async () => {
    ;(globalThis as { fetch: typeof fetch }).fetch = (async () => jsonResponse({
      ok: false,
      error: 'settings-not-exposed',
    })) as typeof fetch

    const snapshot = projectDocuments({
      [FRIEND_SETTINGS_NAMESPACES.asr]: { hotkey: 'Alt+S' },
    })
    const form = createAsrSectionForm(
      snapshot.asr,
      createFriendSettingsPatchWriter(FRIEND_SETTINGS_NAMESPACES.asr),
    )
    form.set('hotkey', 'Alt+Q')
    await expect(form.commit()).rejects.toThrow(/settings-not-exposed|settings patch failed/u)
    expect(form.isDirty()).toBe(true)
    expect(form.getCommitted().hotkey).toBe('Alt+S')
  })

  it('throws when fetch is missing so commit cannot mark the form clean', async () => {
    delete (globalThis as { fetch?: typeof fetch }).fetch
    const writer = createFriendSettingsPatchWriter(FRIEND_SETTINGS_NAMESPACES.asr)
    await expect(writer.set('hotkey', 'Alt+Q')).rejects.toThrow(/settings patch failed/u)
  })
})

describe('readFriendSettingsSnapshot', () => {
  it('accepts a projected GET /friend/settings/snapshot body', () => {
    const snapshot = projectDocuments({
      [FRIEND_SETTINGS_NAMESPACES.asr]: { hotkey: 'Alt+Q', mode: 'toggle' },
    })
    expect(readFriendSettingsSnapshot(snapshot)?.asr).toMatchObject({
      hotkey: 'Alt+Q',
      mode: 'toggle',
    })
  })

  it('rejects incomplete payloads', () => {
    expect(readFriendSettingsSnapshot(undefined)).toBeUndefined()
    expect(readFriendSettingsSnapshot({ ok: true })).toBeUndefined()
    expect(readFriendSettingsSnapshot({ asr: { hotkey: 'Alt+Q' } })).toBeUndefined()
  })
})
