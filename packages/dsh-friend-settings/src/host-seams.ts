/**
 * Host-only official TTS/ASR sanitizers.
 *
 * Must not be imported from the client half — those packages' main
 * entries pull Node transports. Client decode keeps the local copies
 * in `sanitize.ts`.
 */
import {
  readFriendAsrSettings,
  sanitizeAsrSettingsForClient,
} from '@wish233/dsh-friend-asr'
import {
  sanitizeTtsSettingsForClient,
  toClientTtsSnapshot,
} from '@wish233/dsh-friend-tts'

import { isRecord, type JsonRecord, type SettingsSanitizeSeams } from './sanitize.ts'

export function createOfficialSanitizeSeams(): SettingsSanitizeSeams {
  return {
    sanitizeTts: sanitizeTtsSettingsForClient,
    projectTts: (raw) => toJsonRecord(toClientTtsSnapshot(raw)),
    sanitizeAsr: sanitizeAsrSettingsForClient,
    projectAsr: (raw) => toJsonRecord(readFriendAsrSettings(raw)),
  }
}

function toJsonRecord(value: object): JsonRecord {
  return isRecord(value) ? { ...value } : {}
}
