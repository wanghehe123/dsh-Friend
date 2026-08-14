/**
 * Aggregate every Friend settings namespace into one client-readable document.
 *
 * Secret fields are dropped. Model overrides keep a `hasApiKey` flag only.
 */
import { FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared/universal'

import { readCoreSettings, readCurrentSlug, type FriendCoreSettings } from './core-settings.ts'
import {
  defaultProjectAsr,
  defaultProjectTts,
  isRecord,
  projectModelOverride,
  stripSecretFields,
  type JsonRecord,
  type SettingsSanitizeSeams,
} from './sanitize.ts'

export type SettingsReader = {
  get(namespace: string): unknown
}

export type ClientTtsProjection = JsonRecord & { hasApiKey: boolean }
export type ClientAsrProjection = JsonRecord & { hasApiKey: boolean }

export type ClientPersonaProjection = {
  currentSlug: string
  chatModel: unknown
}

export type ClientMemoryProjection = {
  enabled: boolean
  autoSummaryEnabled: boolean
  autoSummaryIdleMinutes: number
  distillHour: number
  distillMinute: number
  memoryMaxBytes: number
  bootstrapBudgetBytes: number
  summarizeModel: unknown
}

export type ClientGrowthProjection = {
  enabled: boolean
  language: string
  model: unknown
}

export type ClientStageProjection = {
  targetFps: number
  floatLeft?: number
  floatTop?: number
  floatWidth: number
  floatHeight: number
}

export type ClientReactionsProjection = {
  enabled: boolean
  level: string
  globalCooldownMs: number
  kindCooldownMs: number
  toolLongMs: number
  quietHours: unknown
  quietCron: unknown
  mutedSessions: unknown
  celebrateProbability: number
  language: string
}

export type FriendClientSettingsSnapshot = {
  core: FriendCoreSettings
  persona: ClientPersonaProjection
  tts: ClientTtsProjection
  asr: ClientAsrProjection
  memory: ClientMemoryProjection
  growth: ClientGrowthProjection
  stage: ClientStageProjection
  reactions: ClientReactionsProjection
  pet: unknown
}

export type ProjectClientSettingsOptions = {
  seams?: SettingsSanitizeSeams
}

export function readSettingsSection(reader: SettingsReader | undefined, namespace: string): unknown {
  if (reader === undefined) {
    return undefined
  }
  try {
    return reader.get(namespace)
  } catch {
    return undefined
  }
}

export function projectClientSettings(
  reader: SettingsReader | undefined,
  options: ProjectClientSettingsOptions = {},
): FriendClientSettingsSnapshot {
  const seams = options.seams ?? {}
  const coreRaw = readSettingsSection(reader, FRIEND_SETTINGS_NAMESPACES.core)
  const personaRaw = readSettingsSection(reader, FRIEND_SETTINGS_NAMESPACES.persona)
  const ttsRaw = readSettingsSection(reader, FRIEND_SETTINGS_NAMESPACES.tts)
  const asrRaw = readSettingsSection(reader, FRIEND_SETTINGS_NAMESPACES.asr)
  const memoryRaw = readSettingsSection(reader, FRIEND_SETTINGS_NAMESPACES.memory)
  const growthRaw = readSettingsSection(reader, FRIEND_SETTINGS_NAMESPACES.growth)
  const stageRaw = readSettingsSection(reader, FRIEND_SETTINGS_NAMESPACES.stage)
  const reactionsRaw = readSettingsSection(reader, FRIEND_SETTINGS_NAMESPACES.reactions)
  const petRaw = readSettingsSection(reader, FRIEND_SETTINGS_NAMESPACES.pet)

  return {
    core: readCoreSettings(coreRaw),
    persona: projectPersona(personaRaw),
    tts: projectFlagged(ttsRaw, seams.projectTts, seams.sanitizeTts, defaultProjectTts),
    asr: projectFlagged(asrRaw, seams.projectAsr, seams.sanitizeAsr, defaultProjectAsr),
    memory: projectMemory(memoryRaw),
    growth: projectGrowth(growthRaw),
    stage: projectStage(stageRaw),
    reactions: projectReactions(reactionsRaw),
    pet: stripSecretFields(petRaw),
  }
}

export function projectDocuments(
  documents: Partial<Record<string, unknown>>,
  options: ProjectClientSettingsOptions = {},
): FriendClientSettingsSnapshot {
  return projectClientSettings(
    {
      get(namespace) {
        return documents[namespace]
      },
    },
    options,
  )
}

function projectPersona(raw: unknown): ClientPersonaProjection {
  const record = isRecord(raw) ? raw : undefined
  return {
    currentSlug: readCurrentSlug(raw),
    chatModel: projectModelOverride(record?.chatModel),
  }
}

function projectMemory(raw: unknown): ClientMemoryProjection {
  const record = isRecord(raw) ? raw : {}
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
    autoSummaryEnabled: typeof record.autoSummaryEnabled === 'boolean' ? record.autoSummaryEnabled : true,
    autoSummaryIdleMinutes: readInt(record.autoSummaryIdleMinutes, 10, 1, 24 * 60),
    distillHour: readInt(record.distillHour, 4, 0, 23),
    distillMinute: readInt(record.distillMinute, 0, 0, 59),
    memoryMaxBytes: readInt(record.memoryMaxBytes, 8 * 1024, 1024, 256 * 1024),
    bootstrapBudgetBytes: readInt(record.bootstrapBudgetBytes, 12 * 1024, 1024, 256 * 1024),
    summarizeModel: projectModelOverride(record.summarizeModel),
  }
}

function projectGrowth(raw: unknown): ClientGrowthProjection {
  const record = isRecord(raw) ? raw : {}
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
    language: typeof record.language === 'string' && record.language.trim().length > 0
      ? record.language.trim()
      : '中文',
    model: projectModelOverride(record.model),
  }
}

function projectStage(raw: unknown): ClientStageProjection {
  const record = isRecord(raw) ? raw : {}
  const floatLeft = optionalNumber(record.floatLeft)
  const floatTop = optionalNumber(record.floatTop)
  return {
    targetFps: readInt(record.targetFps, 30, 1, 120),
    ...(floatLeft !== undefined ? { floatLeft } : {}),
    ...(floatTop !== undefined ? { floatTop } : {}),
    floatWidth: readInt(record.floatWidth, 280, 160, 1200),
    floatHeight: readInt(record.floatHeight, 360, 200, 1600),
  }
}

function projectReactions(raw: unknown): ClientReactionsProjection {
  const record = isRecord(raw) ? raw : {}
  const level = record.level === 'bubble' || record.level === 'voice' || record.level === 'action'
    ? record.level
    : 'action'
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
    level,
    globalCooldownMs: readInt(record.globalCooldownMs, 45_000, 0, 3_600_000),
    kindCooldownMs: readInt(record.kindCooldownMs, 5 * 60_000, 0, 3_600_000),
    toolLongMs: readInt(record.toolLongMs, 30_000, 1_000, 600_000),
    quietHours: Array.isArray(record.quietHours) ? record.quietHours : [],
    quietCron: Array.isArray(record.quietCron) ? record.quietCron : [],
    mutedSessions: Array.isArray(record.mutedSessions) ? record.mutedSessions : [],
    celebrateProbability: typeof record.celebrateProbability === 'number'
      && Number.isFinite(record.celebrateProbability)
      ? Math.min(1, Math.max(0, record.celebrateProbability))
      : 1,
    language: typeof record.language === 'string' && record.language.trim().length > 0
      ? record.language.trim()
      : 'zh',
  }
}

function projectFlagged(
  raw: unknown,
  project: ((value: unknown) => JsonRecord) | undefined,
  sanitize: ((value: unknown) => unknown) | undefined,
  fallback: (value: unknown) => JsonRecord,
): JsonRecord & { hasApiKey: boolean } {
  const projected = asClientFlagged(project?.(raw) ?? fallback(raw))
  if (sanitize === undefined) {
    return projected
  }
  const cleaned = sanitize(projected)
  const record = isRecord(cleaned) ? { ...cleaned } : { ...projected }
  return {
    ...record,
    hasApiKey: projected.hasApiKey,
  }
}

function asClientFlagged(value: unknown): JsonRecord & { hasApiKey: boolean } {
  const record = isRecord(value) ? { ...value } : {}
  return {
    ...record,
    hasApiKey: record.hasApiKey === true,
  }
}

function readInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.round(value)))
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
