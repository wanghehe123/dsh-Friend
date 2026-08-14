import { FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared'

import {
  DEFAULT_CHARACTER_SLUG,
  DEFAULT_MEMORY_MAX_BYTES,
  PERSONA_CURRENT_SLUG_FIELD,
} from './paths.ts'

export const MEMORY_SETTINGS_NAMESPACE = FRIEND_SETTINGS_NAMESPACES.memory
export const PERSONA_SETTINGS_NAMESPACE = FRIEND_SETTINGS_NAMESPACES.persona

export const MEMORY_SETTING_FIELDS = {
  enabled: 'enabled',
  autoSummaryEnabled: 'autoSummaryEnabled',
  autoSummaryIdleMinutes: 'autoSummaryIdleMinutes',
  distillHour: 'distillHour',
  distillMinute: 'distillMinute',
  memoryMaxBytes: 'memoryMaxBytes',
  bootstrapBudgetBytes: 'bootstrapBudgetBytes',
  summarizeModel: 'summarizeModel',
} as const

export type MemorySettings = {
  enabled: boolean
  autoSummaryEnabled: boolean
  autoSummaryIdleMinutes: number
  distillHour: number
  distillMinute: number
  memoryMaxBytes: number
  bootstrapBudgetBytes: number
  summarizeModel: unknown
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  autoSummaryEnabled: true,
  autoSummaryIdleMinutes: 10,
  distillHour: 4,
  distillMinute: 0,
  memoryMaxBytes: DEFAULT_MEMORY_MAX_BYTES,
  bootstrapBudgetBytes: 12 * 1024,
  summarizeModel: undefined,
}

export type SettingsReader = {
  get(namespace: string): unknown
}

export function readMemorySettings(section: unknown): MemorySettings {
  const record = asRecord(section)
  return {
    enabled: readBoolean(record, MEMORY_SETTING_FIELDS.enabled, DEFAULT_MEMORY_SETTINGS.enabled),
    autoSummaryEnabled: readBoolean(
      record,
      MEMORY_SETTING_FIELDS.autoSummaryEnabled,
      DEFAULT_MEMORY_SETTINGS.autoSummaryEnabled,
    ),
    autoSummaryIdleMinutes: readInt(
      record,
      MEMORY_SETTING_FIELDS.autoSummaryIdleMinutes,
      DEFAULT_MEMORY_SETTINGS.autoSummaryIdleMinutes,
      1,
      24 * 60,
    ),
    distillHour: readInt(record, MEMORY_SETTING_FIELDS.distillHour, DEFAULT_MEMORY_SETTINGS.distillHour, 0, 23),
    distillMinute: readInt(
      record,
      MEMORY_SETTING_FIELDS.distillMinute,
      DEFAULT_MEMORY_SETTINGS.distillMinute,
      0,
      59,
    ),
    memoryMaxBytes: readInt(
      record,
      MEMORY_SETTING_FIELDS.memoryMaxBytes,
      DEFAULT_MEMORY_SETTINGS.memoryMaxBytes,
      1024,
      256 * 1024,
    ),
    bootstrapBudgetBytes: readInt(
      record,
      MEMORY_SETTING_FIELDS.bootstrapBudgetBytes,
      DEFAULT_MEMORY_SETTINGS.bootstrapBudgetBytes,
      1024,
      256 * 1024,
    ),
    summarizeModel: record === undefined ? undefined : record[MEMORY_SETTING_FIELDS.summarizeModel],
  }
}

export function resolveMemorySettings(settings: SettingsReader | undefined): MemorySettings {
  if (settings === undefined) {
    return { ...DEFAULT_MEMORY_SETTINGS }
  }
  try {
    return readMemorySettings(settings.get(MEMORY_SETTINGS_NAMESPACE))
  } catch {
    return { ...DEFAULT_MEMORY_SETTINGS }
  }
}

/**
 * Active character slug from `friend-persona.currentSlug`.
 * Missing / blank / illegal values fall back to the built-in default slug.
 */
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

function readInt(
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
  return Math.min(max, Math.max(min, Math.round(value)))
}
