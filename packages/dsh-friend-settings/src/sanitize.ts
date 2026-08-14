/**
 * Client-safe projection helpers.
 *
 * TTS / ASR already own sanitizers. This package copies their secret-field
 * lists and boolean `hasApiKey` projection so the client half never imports
 * those host packages. Host apply() can replace these with the official
 * functions through {@link SettingsSanitizeSeams}.
 */

export const FRIEND_SECRET_FIELDS = [
  'apiKey',
  'openaiApiKey',
  'authorization',
  'Authorization',
] as const

export type FriendSecretField = (typeof FRIEND_SECRET_FIELDS)[number]

export type JsonRecord = Record<string, unknown>

export type SettingsSanitizeSeams = {
  sanitizeTts?: (raw: unknown) => unknown
  projectTts?: (raw: unknown) => JsonRecord
  sanitizeAsr?: (raw: unknown) => unknown
  projectAsr?: (raw: unknown) => JsonRecord
}

export function isSecretField(key: string): boolean {
  return (FRIEND_SECRET_FIELDS as readonly string[]).includes(key)
}

export function stripSecretFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripSecretFields)
  }
  if (!isRecord(value)) {
    return value
  }
  const out: JsonRecord = {}
  for (const [key, child] of Object.entries(value)) {
    if (isSecretField(key)) {
      continue
    }
    out[key] = stripSecretFields(child)
  }
  return out
}

export function hasSecretMaterial(raw: unknown): boolean {
  if (Array.isArray(raw)) {
    return raw.some(hasSecretMaterial)
  }
  if (!isRecord(raw)) {
    return false
  }
  for (const [key, child] of Object.entries(raw)) {
    if (isSecretField(key) && typeof child === 'string' && child.trim().length > 0) {
      return true
    }
    if (hasSecretMaterial(child)) {
      return true
    }
  }
  return false
}

export function projectModelOverride(raw: unknown): unknown {
  if (typeof raw === 'string') {
    return raw
  }
  if (!isRecord(raw)) {
    return undefined
  }
  const stripped = stripSecretFields(raw)
  if (!isRecord(stripped)) {
    return undefined
  }
  return {
    ...stripped,
    hasApiKey: hasSecretMaterial(raw),
  }
}

export function defaultProjectTts(raw: unknown): JsonRecord {
  const host = asRecord(raw) ?? {}
  const nested = isRecord(host.openai) ? host.openai : undefined
  const snapshot: JsonRecord = {
    hasApiKey: hasSecretMaterial(raw),
  }
  assignString(snapshot, 'provider', asNonEmptyString(host.provider))
  assignString(snapshot, 'voice', asNonEmptyString(host.voice))
  assignNumber(snapshot, 'rate', asFiniteNumber(host.rate))
  assignNumber(snapshot, 'pitch', asFiniteNumber(host.pitch))
  assignBoolean(snapshot, 'autoSpeak', asBoolean(host.autoSpeak))
  assignBoolean(snapshot, 'stripStageDirections', asBoolean(host.stripStageDirections))
  assignNumber(snapshot, 'volume', asFiniteNumber(host.volume))
  assignBoolean(snapshot, 'muted', asBoolean(host.muted))
  assignString(
    snapshot,
    'openaiBaseURL',
    asNonEmptyString(host.openaiBaseURL)
      ?? asNonEmptyString(host.baseURL)
      ?? (nested !== undefined ? asNonEmptyString(nested.baseURL) : undefined),
  )
  assignString(
    snapshot,
    'openaiModel',
    asNonEmptyString(host.openaiModel)
      ?? (nested !== undefined ? asNonEmptyString(nested.model) : undefined),
  )
  assignString(
    snapshot,
    'openaiFormat',
    asNonEmptyString(host.openaiFormat)
      ?? asNonEmptyString(host.format)
      ?? (nested !== undefined ? asNonEmptyString(nested.format) : undefined),
  )
  return snapshot
}

export function defaultProjectAsr(raw: unknown): JsonRecord {
  const host = asRecord(raw) ?? {}
  const nested = isRecord(host.openai) ? host.openai : undefined
  const snapshot: JsonRecord = {
    hotkey: typeof host.hotkey === 'string' && host.hotkey.length > 0 ? host.hotkey : 'Alt+S',
    mode: host.mode === 'hold' || host.mode === 'toggle' || host.mode === 'auto' ? host.mode : 'hold',
    silenceMs: typeof host.silenceMs === 'number' && Number.isFinite(host.silenceMs) && host.silenceMs > 0
      ? host.silenceMs
      : 1200,
    bargeIn: typeof host.bargeIn === 'boolean' ? host.bargeIn : true,
    language: typeof host.language === 'string' && host.language.length > 0 ? host.language : 'zh-CN',
    engine: host.engine === 'auto' || host.engine === 'webspeech' || host.engine === 'endpoint'
      ? host.engine
      : 'auto',
    autoSend: typeof host.autoSend === 'boolean' ? host.autoSend : true,
    hasApiKey: hasSecretMaterial(raw),
  }
  assignString(
    snapshot,
    'openaiBaseURL',
    asNonEmptyString(host.openaiBaseURL)
      ?? asNonEmptyString(host.baseURL)
      ?? (nested !== undefined ? asNonEmptyString(nested.baseURL) : undefined),
  )
  assignString(
    snapshot,
    'openaiModel',
    asNonEmptyString(host.openaiModel)
      ?? (nested !== undefined ? asNonEmptyString(nested.model) : undefined),
  )
  return snapshot
}

export function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function assignString(target: JsonRecord, key: string, value: string | undefined): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function assignNumber(target: JsonRecord, key: string, value: number | undefined): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function assignBoolean(target: JsonRecord, key: string, value: boolean | undefined): void {
  if (value !== undefined) {
    target[key] = value
  }
}
