/**
 * Host-only schemastery schema for `friend-persona`.
 * Imported from `index.ts` only — never from the client half.
 */
import { Schema, type FriendSchema } from '@wishp3/dsh-friend-shared'

import { DEFAULT_PERSONA_SLUG } from './default-persona.ts'

export const DEFAULT_PERSONA_SETTINGS_ENTRY = {
  currentSlug: DEFAULT_PERSONA_SLUG,
}

export function createFriendPersonaSettingsSchema(): FriendSchema {
  return Schema.object({
    currentSlug: Schema.string().default(DEFAULT_PERSONA_SLUG),
    chatModel: Schema.any(),
  })
}
