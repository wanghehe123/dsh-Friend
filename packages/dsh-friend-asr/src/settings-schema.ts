/**
 * Host-only schemastery schema for `friend-asr`.
 * Imported from `index.ts` only — never from the client half.
 */
import { Schema, type FriendSchema } from '@wishp3/dsh-friend-shared'

import { ASR_SETTINGS_DEFAULTS } from './settings.ts'

export const DEFAULT_ASR_SETTINGS_ENTRY = {
  hotkey: ASR_SETTINGS_DEFAULTS.hotkey,
  mode: ASR_SETTINGS_DEFAULTS.mode,
  silenceMs: ASR_SETTINGS_DEFAULTS.silenceMs,
  bargeIn: ASR_SETTINGS_DEFAULTS.bargeIn,
  language: ASR_SETTINGS_DEFAULTS.language,
  engine: ASR_SETTINGS_DEFAULTS.engine,
  autoSend: ASR_SETTINGS_DEFAULTS.autoSend,
}

export function createFriendAsrSettingsSchema(): FriendSchema {
  return Schema.object({
    hotkey: Schema.string().default(ASR_SETTINGS_DEFAULTS.hotkey),
    mode: Schema.union(['hold', 'toggle', 'auto'] as const).default(ASR_SETTINGS_DEFAULTS.mode),
    silenceMs: Schema.number().default(ASR_SETTINGS_DEFAULTS.silenceMs),
    bargeIn: Schema.boolean().default(ASR_SETTINGS_DEFAULTS.bargeIn),
    language: Schema.string().default(ASR_SETTINGS_DEFAULTS.language),
    engine: Schema.union(['auto', 'webspeech', 'endpoint'] as const).default(ASR_SETTINGS_DEFAULTS.engine),
    autoSend: Schema.boolean().default(ASR_SETTINGS_DEFAULTS.autoSend),
    openaiApiKey: Schema.string().role('secret'),
    openaiBaseURL: Schema.string(),
    openaiModel: Schema.string(),
  })
}
