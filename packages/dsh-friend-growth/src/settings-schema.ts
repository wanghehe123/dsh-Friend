/**
 * Host-only schemastery schema for `friend-growth`.
 * Imported from `index.ts` only — never from the client half.
 */
import { Schema, type FriendSchema } from '@wish233/dsh-friend-shared'

import { DEFAULT_GROWTH_SETTINGS } from './settings.ts'

export const DEFAULT_GROWTH_SETTINGS_ENTRY = {
  enabled: DEFAULT_GROWTH_SETTINGS.enabled,
  language: DEFAULT_GROWTH_SETTINGS.language,
}

export function createFriendGrowthSettingsSchema(): FriendSchema {
  return Schema.object({
    enabled: Schema.boolean().default(DEFAULT_GROWTH_SETTINGS.enabled),
    language: Schema.string().default(DEFAULT_GROWTH_SETTINGS.language),
    model: Schema.any(),
  })
}
