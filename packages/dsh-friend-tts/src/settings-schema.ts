/**
 * Host-only schemastery schema for `friend-tts`.
 * Imported from `index.ts` only — never from the client half.
 */
import { Schema, type FriendSchema } from '@wish233/dsh-friend-shared'

import { TTS_SETTINGS_FORM_DEFAULTS } from './settings-form.ts'

export const DEFAULT_TTS_SETTINGS_ENTRY = {
  ...TTS_SETTINGS_FORM_DEFAULTS,
}

export function createFriendTtsSettingsSchema(): FriendSchema {
  return Schema.object({
    provider: Schema.string().default(TTS_SETTINGS_FORM_DEFAULTS.provider),
    voice: Schema.string().default(TTS_SETTINGS_FORM_DEFAULTS.voice),
    rate: Schema.number().default(TTS_SETTINGS_FORM_DEFAULTS.rate),
    pitch: Schema.number().default(TTS_SETTINGS_FORM_DEFAULTS.pitch),
    autoSpeak: Schema.boolean().default(TTS_SETTINGS_FORM_DEFAULTS.autoSpeak),
    stripStageDirections: Schema.boolean().default(TTS_SETTINGS_FORM_DEFAULTS.stripStageDirections),
    // Unique playback source. Aliases live on friend-core / friend-stage.
    volume: Schema.number().default(TTS_SETTINGS_FORM_DEFAULTS.volume),
    muted: Schema.boolean().default(TTS_SETTINGS_FORM_DEFAULTS.muted),
    openaiApiKey: Schema.string().role('secret'),
    openaiBaseURL: Schema.string(),
    openaiModel: Schema.string(),
    openaiFormat: Schema.string(),
  })
}
