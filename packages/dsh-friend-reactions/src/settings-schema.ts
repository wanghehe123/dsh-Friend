/**
 * Host-only schemastery schema for `friend-reactions`.
 * Imported from `index.ts` only — never from the client half.
 */
import { Schema, type FriendSchema } from '@wishp3/dsh-friend-shared'

import { DEFAULT_REACTION_SETTINGS } from './settings.ts'

export const DEFAULT_REACTIONS_SETTINGS_ENTRY = {
  enabled: DEFAULT_REACTION_SETTINGS.enabled,
  level: DEFAULT_REACTION_SETTINGS.level,
  globalCooldownMs: DEFAULT_REACTION_SETTINGS.globalCooldownMs,
  kindCooldownMs: DEFAULT_REACTION_SETTINGS.kindCooldownMs,
  toolLongMs: DEFAULT_REACTION_SETTINGS.toolLongMs,
  quietHours: DEFAULT_REACTION_SETTINGS.quietHours,
  quietCron: DEFAULT_REACTION_SETTINGS.quietCron,
  mutedSessions: DEFAULT_REACTION_SETTINGS.mutedSessions,
  celebrateProbability: DEFAULT_REACTION_SETTINGS.celebrateProbability,
  language: DEFAULT_REACTION_SETTINGS.language,
}

export function createFriendReactionsSettingsSchema(): FriendSchema {
  return Schema.object({
    enabled: Schema.boolean().default(DEFAULT_REACTION_SETTINGS.enabled),
    level: Schema.union(['action', 'bubble', 'voice'] as const).default(DEFAULT_REACTION_SETTINGS.level),
    globalCooldownMs: Schema.number().default(DEFAULT_REACTION_SETTINGS.globalCooldownMs),
    kindCooldownMs: Schema.number().default(DEFAULT_REACTION_SETTINGS.kindCooldownMs),
    toolLongMs: Schema.number().default(DEFAULT_REACTION_SETTINGS.toolLongMs),
    quietHours: Schema.array(Schema.object({
      start: Schema.string(),
      end: Schema.string(),
    })).default([]),
    quietCron: Schema.array(Schema.string()).default([]),
    mutedSessions: Schema.array(Schema.string()).default([]),
    celebrateProbability: Schema.number().default(DEFAULT_REACTION_SETTINGS.celebrateProbability),
    language: Schema.string().default(DEFAULT_REACTION_SETTINGS.language),
  })
}
