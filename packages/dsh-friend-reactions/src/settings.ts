import { FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared'

export const REACTIONS_SETTINGS_NAMESPACE = FRIEND_SETTINGS_NAMESPACES.reactions
export const CORE_SETTINGS_NAMESPACE = FRIEND_SETTINGS_NAMESPACES.core

const ENABLED_FIELD = 'enabled' as const

export const REACTION_LEVELS = ['action', 'bubble', 'voice'] as const
export type ReactionLevel = (typeof REACTION_LEVELS)[number]

export type QuietWindow = {
  start: string
  end: string
}

export type ReactionSettings = {
  /**
   * Effective gate used by the engine on every decide/react.
   * `friend-core.enabled` AND `friend-reactions.enabled` — either switch
   * off means no reaction is produced (W-M8-1 cascade).
   */
  enabled: boolean
  level: ReactionLevel
  globalCooldownMs: number
  kindCooldownMs: number
  /**
   * Retained for existing config files. Unused: DSH `tool/result` has no
   * duration field, so `tool-long` cannot be classified.
   */
  toolLongMs: number
  quietHours: QuietWindow[]
  quietCron: string[]
  mutedSessions: string[]
  celebrateProbability: number
  language: string
}

export const DEFAULT_REACTION_SETTINGS: ReactionSettings = {
  enabled: true,
  level: 'action',
  globalCooldownMs: 45_000,
  kindCooldownMs: 5 * 60_000,
  toolLongMs: 30_000,
  quietHours: [],
  quietCron: [],
  mutedSessions: [],
  celebrateProbability: 1,
  language: 'zh',
}

export type SettingsReader = {
  get(namespace: string): unknown
}

export function readReactionSettings(section: unknown): ReactionSettings {
  const record = asRecord(section)
  return {
    enabled: readBoolean(record, ENABLED_FIELD, DEFAULT_REACTION_SETTINGS.enabled),
    level: readLevel(record?.level),
    globalCooldownMs: readInt(record, 'globalCooldownMs', DEFAULT_REACTION_SETTINGS.globalCooldownMs, 0, 3_600_000),
    kindCooldownMs: readInt(record, 'kindCooldownMs', DEFAULT_REACTION_SETTINGS.kindCooldownMs, 0, 3_600_000),
    toolLongMs: readInt(record, 'toolLongMs', DEFAULT_REACTION_SETTINGS.toolLongMs, 1_000, 600_000),
    quietHours: readWindows(record?.quietHours),
    quietCron: readStringList(record?.quietCron),
    mutedSessions: readStringList(record?.mutedSessions),
    celebrateProbability: readNumber(record, 'celebrateProbability', DEFAULT_REACTION_SETTINGS.celebrateProbability, 0, 1),
    language: readString(record, 'language', DEFAULT_REACTION_SETTINGS.language),
  }
}

/**
 * Master switch and the reactions section switch are AND: both must be
 * true to emit. Re-read on every decide/react — do not snapshot at apply().
 */
export function reactionsAreLive(coreEnabled: boolean, reactionsEnabled: boolean): boolean {
  return coreEnabled && reactionsEnabled
}

export function resolveReactionSettings(settings: SettingsReader | undefined): ReactionSettings {
  if (settings === undefined) {
    return { ...DEFAULT_REACTION_SETTINGS, quietHours: [], quietCron: [], mutedSessions: [] }
  }
  const reactions = readReactionsSection(settings)
  return {
    ...reactions,
    enabled: reactionsAreLive(readCoreEnabled(settings), reactions.enabled),
  }
}

function readReactionsSection(settings: SettingsReader): ReactionSettings {
  try {
    return readReactionSettings(settings.get(REACTIONS_SETTINGS_NAMESPACE))
  } catch {
    return readReactionSettings(undefined)
  }
}

function readCoreEnabled(settings: SettingsReader): boolean {
  try {
    const record = asRecord(settings.get(CORE_SETTINGS_NAMESPACE))
    return readBoolean(record, ENABLED_FIELD, true)
  } catch {
    return true
  }
}

function readLevel(value: unknown): ReactionLevel {
  return value === 'bubble' || value === 'voice' || value === 'action' ? value : 'action'
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function readBoolean(record: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean {
  const value = record?.[key]
  return typeof value === 'boolean' ? value : fallback
}

function readString(record: Record<string, unknown> | undefined, key: string, fallback: string): string {
  const value = record?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
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

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function readWindows(value: unknown): QuietWindow[] {
  if (!Array.isArray(value)) {
    return []
  }
  const windows: QuietWindow[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const record = item as Record<string, unknown>
    if (typeof record.start === 'string' && typeof record.end === 'string') {
      windows.push({ start: record.start, end: record.end })
    }
  }
  return windows
}
