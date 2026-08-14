/**
 * Host-only schemastery schema for `friend-core`.
 * Imported from `index.ts` only — never from the client half.
 */
import { Schema, type FriendSchema } from '@wish233/dsh-friend-shared'

import { DEFAULT_CORE_SETTINGS, type FriendCoreSettings } from './core-settings.ts'

export type FriendCoreSettingsEntry = FriendCoreSettings & {
  companionSessionId?: string
}

export const DEFAULT_CORE_SETTINGS_ENTRY: FriendCoreSettingsEntry = {
  ...DEFAULT_CORE_SETTINGS,
}

export function createFriendCoreSettingsSchema(): FriendSchema {
  return Schema.object({
    enabled: Schema.boolean().default(DEFAULT_CORE_SETTINGS.enabled),
    floatEnabled: Schema.boolean().default(DEFAULT_CORE_SETTINGS.floatEnabled),
    volume: Schema.number().default(DEFAULT_CORE_SETTINGS.volume),
    muted: Schema.boolean().default(DEFAULT_CORE_SETTINGS.muted),
    language: Schema.union(['zh', 'en', 'system'] as const).default(DEFAULT_CORE_SETTINGS.language),
    companionSessionId: Schema.string(),
  })
}
