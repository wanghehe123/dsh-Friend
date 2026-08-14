/**
 * `friend-core` document owned by the settings parent card.
 *
 * Other packages already store `companionSessionId` here (persona session).
 * This package adds the master switch, float, volume, and UI language.
 */
import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared/universal'

export const CORE_SETTINGS_NAMESPACE = FRIEND_SETTINGS_NAMESPACES.core

export const CORE_SETTING_FIELDS = {
  enabled: 'enabled',
  floatEnabled: 'floatEnabled',
  volume: 'volume',
  muted: 'muted',
  language: 'language',
  companionSessionId: 'companionSessionId',
} as const

export const PERSONA_CURRENT_SLUG_FIELD = 'currentSlug' as const
export const DEFAULT_CHARACTER_SLUG = 'default' as const

export type FriendUiLanguage = 'zh' | 'en' | 'system'

export type FriendCoreSettings = {
  enabled: boolean
  floatEnabled: boolean
  volume: number
  muted: boolean
  language: FriendUiLanguage
}

export const DEFAULT_CORE_SETTINGS: FriendCoreSettings = {
  enabled: true,
  floatEnabled: true,
  volume: 1,
  muted: false,
  language: 'system',
}

export function readCoreSettings(section: unknown): FriendCoreSettings {
  const record = asRecord(section)
  return {
    enabled: readBoolean(record, CORE_SETTING_FIELDS.enabled, DEFAULT_CORE_SETTINGS.enabled),
    floatEnabled: readBoolean(
      record,
      CORE_SETTING_FIELDS.floatEnabled,
      DEFAULT_CORE_SETTINGS.floatEnabled,
    ),
    volume: readNumber(record, CORE_SETTING_FIELDS.volume, DEFAULT_CORE_SETTINGS.volume, 0, 1),
    muted: readBoolean(record, CORE_SETTING_FIELDS.muted, DEFAULT_CORE_SETTINGS.muted),
    language: readLanguage(record?.[CORE_SETTING_FIELDS.language]),
  }
}

export function readCurrentSlug(section: unknown): string {
  const record = asRecord(section)
  const raw = record?.[PERSONA_CURRENT_SLUG_FIELD]
  if (typeof raw !== 'string') {
    return DEFAULT_CHARACTER_SLUG
  }
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : DEFAULT_CHARACTER_SLUG
}

export function resolveUiLanguage(
  stored: FriendUiLanguage,
  systemLanguage: string | undefined = defaultSystemLanguage(),
): 'zh' | 'en' {
  if (stored === 'zh' || stored === 'en') {
    return stored
  }
  const source = systemLanguage ?? 'zh'
  return source.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

export function childControlsEnabled(core: FriendCoreSettings): boolean {
  return core.enabled
}

function defaultSystemLanguage(): string | undefined {
  const intl = globalThis as { navigator?: { language?: string } }
  return intl.navigator?.language
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function readBoolean(
  record: Record<string, unknown> | undefined,
  key: string,
  fallback: boolean,
): boolean {
  const value = record?.[key]
  return typeof value === 'boolean' ? value : fallback
}

function readNumber(
  record: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = record?.[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, value))
}

function readLanguage(value: unknown): FriendUiLanguage {
  return value === 'zh' || value === 'en' || value === 'system' ? value : DEFAULT_CORE_SETTINGS.language
}
