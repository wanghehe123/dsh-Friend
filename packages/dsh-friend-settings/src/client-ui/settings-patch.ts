/**
 * Persist Friend settings from the browser.
 *
 * Official `settingsScope.set()` goes through web `settings.mutate`. That
 * API only accepts exposedNamespaces (model providers + a fixed product
 * list). Friend kebab namespaces come back as `settings-not-exposed`; the
 * official client then reloads and resolves, so Save looks successful
 * while `~/.dsh/settings.yaml` never changes.
 *
 * Host `POST /friend/settings/patch` calls `settings.update` directly.
 */
import {
  FRIEND_SETTINGS_NAMESPACES,
  type FriendSettingsNamespace,
} from '@wish233/dsh-friend-shared/universal'

import {
  FRIEND_SETTINGS_PATCH_PATH,
  FRIEND_SETTINGS_SNAPSHOT_PATH,
} from '../paths.ts'
import type { FriendClientSettingsSnapshot } from '../project.ts'
import type { SettingsFieldWriter } from '../section-forms.ts'
import type { OverlayWriters } from './ConfigOverlay.ts'
import { getJson, isRecord, postJson } from './http.ts'

export async function patchFriendSettings(
  namespace: FriendSettingsNamespace,
  patch: Record<string, unknown>,
): Promise<void> {
  const body = await postJson(FRIEND_SETTINGS_PATCH_PATH, { namespace, patch })
  if (!isRecord(body) || body.ok !== true) {
    const message = isRecord(body) && typeof body.error === 'string' && body.error.trim().length > 0
      ? body.error
      : 'settings patch failed'
    throw new Error(message)
  }
}

export function createFriendSettingsPatchWriter(
  namespace: FriendSettingsNamespace,
): SettingsFieldWriter {
  return {
    async set(field, value) {
      await patchFriendSettings(namespace, { [field]: value })
    },
  }
}

export function createFriendSettingsPatchWriters(): OverlayWriters {
  const persona = createFriendSettingsPatchWriter(FRIEND_SETTINGS_NAMESPACES.persona)
  const memory = createFriendSettingsPatchWriter(FRIEND_SETTINGS_NAMESPACES.memory)
  const growth = createFriendSettingsPatchWriter(FRIEND_SETTINGS_NAMESPACES.growth)
  return {
    core: createFriendSettingsPatchWriter(FRIEND_SETTINGS_NAMESPACES.core),
    persona,
    tts: createFriendSettingsPatchWriter(FRIEND_SETTINGS_NAMESPACES.tts),
    asr: createFriendSettingsPatchWriter(FRIEND_SETTINGS_NAMESPACES.asr),
    memory,
    growth,
    stage: createFriendSettingsPatchWriter(FRIEND_SETTINGS_NAMESPACES.stage),
    reactions: createFriendSettingsPatchWriter(FRIEND_SETTINGS_NAMESPACES.reactions),
    model: {
      setChat: (value) => persona.set('chatModel', value),
      setSummarize: (value) => memory.set('summarizeModel', value),
      setGrowth: (value) => growth.set('model', value),
    },
  }
}

export function readFriendSettingsSnapshot(body: unknown): FriendClientSettingsSnapshot | undefined {
  if (!isRecord(body)) {
    return undefined
  }
  const required = ['core', 'persona', 'tts', 'asr', 'memory', 'growth', 'stage', 'reactions'] as const
  for (const key of required) {
    if (!isRecord(body[key])) {
      return undefined
    }
  }
  return body as FriendClientSettingsSnapshot
}

export async function loadFriendSettingsSnapshot(): Promise<FriendClientSettingsSnapshot | undefined> {
  return readFriendSettingsSnapshot(await getJson(FRIEND_SETTINGS_SNAPSHOT_PATH))
}
