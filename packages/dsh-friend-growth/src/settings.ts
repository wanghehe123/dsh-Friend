import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared'

import { DEFAULT_CHARACTER_SLUG, PERSONA_CURRENT_SLUG_FIELD } from './paths.ts'

export const GROWTH_SETTINGS_NAMESPACE = FRIEND_SETTINGS_NAMESPACES.growth
export const PERSONA_SETTINGS_NAMESPACE = FRIEND_SETTINGS_NAMESPACES.persona

export const GROWTH_SETTING_FIELDS = {
  enabled: 'enabled',
  language: 'language',
  model: 'model',
} as const

export type GrowthSettings = {
  enabled: boolean
  language: string
  model: unknown
}

export const DEFAULT_GROWTH_SETTINGS: GrowthSettings = {
  enabled: true,
  language: '中文',
  model: undefined,
}

export type SettingsReader = {
  get(namespace: string): unknown
}

export function readGrowthSettings(section: unknown): GrowthSettings {
  const record = asRecord(section)
  return {
    enabled: readBoolean(record, GROWTH_SETTING_FIELDS.enabled, DEFAULT_GROWTH_SETTINGS.enabled),
    language: readString(record, GROWTH_SETTING_FIELDS.language, DEFAULT_GROWTH_SETTINGS.language),
    model: record === undefined ? undefined : record[GROWTH_SETTING_FIELDS.model],
  }
}

export function resolveGrowthSettings(settings: SettingsReader | undefined): GrowthSettings {
  if (settings === undefined) {
    return { ...DEFAULT_GROWTH_SETTINGS }
  }
  try {
    return readGrowthSettings(settings.get(GROWTH_SETTINGS_NAMESPACE))
  } catch {
    return { ...DEFAULT_GROWTH_SETTINGS }
  }
}

export function resolveCurrentCharacterSlug(settings: SettingsReader | undefined): string {
  if (settings === undefined) {
    return DEFAULT_CHARACTER_SLUG
  }
  try {
    const section = settings.get(PERSONA_SETTINGS_NAMESPACE)
    const record = asRecord(section)
    const raw = record?.[PERSONA_CURRENT_SLUG_FIELD]
    if (typeof raw !== 'string') {
      return DEFAULT_CHARACTER_SLUG
    }
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : DEFAULT_CHARACTER_SLUG
  } catch {
    return DEFAULT_CHARACTER_SLUG
  }
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

function readString(
  record: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  const value = record?.[key]
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}
