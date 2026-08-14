/**
 * Settings namespace from the platform-neutral shared barrel.
 * `@wish233/dsh-friend-shared` (host) pulls `node:` into the client factory.
 * `@wish233/dsh-friend-shared/client` is a `window.__ModuleLoader__` payload
 * (throws in Node). `@wish233/dsh-friend-shared/universal` is naked ESM and
 * is inlined by the client build (not a platform seed).
 */
import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared/universal'

import type { AsrEnginePreference, AsrListenMode } from './engine.ts'
import { ASR_DEFAULT_HOTKEY, ASR_HOTKEY_FIELD, type AsrHotkeyStore } from './hotkey.ts'
import { ASR_DEFAULT_MODE, ASR_DEFAULT_SILENCE_MS } from './modes.ts'

export const ASR_SETTINGS_NAMESPACE = FRIEND_SETTINGS_NAMESPACES.asr

export const ASR_MODE_FIELD = 'mode'
export const ASR_SILENCE_MS_FIELD = 'silenceMs'
export const ASR_BARGE_IN_FIELD = 'bargeIn'
export const ASR_LANGUAGE_FIELD = 'language'
export const ASR_ENGINE_FIELD = 'engine'
export const ASR_AUTO_SEND_FIELD = 'autoSend'
export const ASR_OPENAI_API_KEY_FIELD = 'openaiApiKey'
export const ASR_OPENAI_BASE_URL_FIELD = 'openaiBaseURL'
export const ASR_OPENAI_MODEL_FIELD = 'openaiModel'

export const FRIEND_ASR_SECRET_FIELDS = [
  'apiKey',
  'openaiApiKey',
  'authorization',
  'Authorization',
] as const

export type FriendAsrSecretField = (typeof FRIEND_ASR_SECRET_FIELDS)[number]

export type FriendAsrSettings = {
  hotkey: string
  mode: AsrListenMode
  silenceMs: number
  bargeIn: boolean
  language: string
  engine: AsrEnginePreference
  autoSend: boolean
  hasApiKey: boolean
  openaiBaseURL?: string
  openaiModel?: string
}

export type FriendAsrHostSettings = {
  hotkey: string
  mode: AsrListenMode
  silenceMs: number
  bargeIn: boolean
  language: string
  engine: AsrEnginePreference
  autoSend: boolean
  openaiApiKey?: string
  openaiBaseURL?: string
  openaiModel?: string
}

export const ASR_SETTINGS_DEFAULTS: FriendAsrSettings = {
  hotkey: ASR_DEFAULT_HOTKEY,
  mode: ASR_DEFAULT_MODE,
  silenceMs: ASR_DEFAULT_SILENCE_MS,
  bargeIn: true,
  language: 'zh-CN',
  engine: 'auto',
  autoSend: true,
  hasApiKey: false,
}

/**
 * Structural settings-scope binder. Same `{ namespace }` shape as shared
 * `bindSettingsClient`; kept local so the client half never imports
 * `@wish233/dsh-friend-shared/client` (that payload starts with `window.`).
 * `@wish233/dsh-friend-shared/universal` is the allowed shared import.
 */
export type AsrSettingsScope = {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value: FriendAsrSettings | undefined
    base: unknown
    user: unknown
    revision: number | undefined
    writable: boolean
    mode: 'host' | 'memory'
  }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

export type AsrSettingsBinder = {
  bind(spec: {
    namespace: typeof ASR_SETTINGS_NAMESPACE
    decode?: (section: unknown) => FriendAsrSettings | undefined
  }): AsrSettingsScope
}

function isListenMode(value: unknown): value is AsrListenMode {
  return value === 'hold' || value === 'toggle' || value === 'auto'
}

function isEnginePreference(value: unknown): value is AsrEnginePreference {
  return value === 'auto' || value === 'webspeech' || value === 'endpoint'
}

function asRecord(source: unknown): Record<string, unknown> {
  if (source !== null && typeof source === 'object') {
    return source as Record<string, unknown>
  }
  return {}
}

export function readFriendAsrHostSettings(source: unknown): FriendAsrHostSettings {
  const record = asRecord(source)
  const nested = isRecord(record.openai) ? record.openai : undefined
  const hotkeyRaw = record[ASR_HOTKEY_FIELD]
  const hotkey = typeof hotkeyRaw === 'string' && hotkeyRaw.length > 0
    ? hotkeyRaw
    : ASR_SETTINGS_DEFAULTS.hotkey
  const modeRaw = record[ASR_MODE_FIELD]
  const mode = isListenMode(modeRaw) ? modeRaw : ASR_SETTINGS_DEFAULTS.mode
  const silenceRaw = record[ASR_SILENCE_MS_FIELD]
  const silenceMs = typeof silenceRaw === 'number' && Number.isFinite(silenceRaw) && silenceRaw > 0
    ? silenceRaw
    : ASR_SETTINGS_DEFAULTS.silenceMs
  const bargeRaw = record[ASR_BARGE_IN_FIELD]
  const bargeIn = typeof bargeRaw === 'boolean' ? bargeRaw : ASR_SETTINGS_DEFAULTS.bargeIn
  const languageRaw = record[ASR_LANGUAGE_FIELD]
  const language = typeof languageRaw === 'string' && languageRaw.length > 0
    ? languageRaw
    : ASR_SETTINGS_DEFAULTS.language
  const engineRaw = record[ASR_ENGINE_FIELD]
  const engine = isEnginePreference(engineRaw) ? engineRaw : ASR_SETTINGS_DEFAULTS.engine
  const autoSendRaw = record[ASR_AUTO_SEND_FIELD]
  const autoSend = typeof autoSendRaw === 'boolean' ? autoSendRaw : ASR_SETTINGS_DEFAULTS.autoSend
  const openaiApiKey = asNonEmptyString(record.openaiApiKey)
    ?? asNonEmptyString(record.apiKey)
    ?? (nested !== undefined ? asNonEmptyString(nested.apiKey) : undefined)
  const openaiBaseURL = asNonEmptyString(record.openaiBaseURL)
    ?? asNonEmptyString(record.baseURL)
    ?? (nested !== undefined ? asNonEmptyString(nested.baseURL) : undefined)
  const openaiModel = asNonEmptyString(record.openaiModel)
    ?? (nested !== undefined ? asNonEmptyString(nested.model) : undefined)
  return {
    hotkey,
    mode,
    silenceMs,
    bargeIn,
    language,
    engine,
    autoSend,
    ...(openaiApiKey !== undefined ? { openaiApiKey } : {}),
    ...(openaiBaseURL !== undefined ? { openaiBaseURL } : {}),
    ...(openaiModel !== undefined ? { openaiModel } : {}),
  }
}

export function readFriendAsrSettings(source: unknown): FriendAsrSettings {
  const host = readFriendAsrHostSettings(source)
  return {
    hotkey: host.hotkey,
    mode: host.mode,
    silenceMs: host.silenceMs,
    bargeIn: host.bargeIn,
    language: host.language,
    engine: host.engine,
    autoSend: host.autoSend,
    hasApiKey: host.openaiApiKey !== undefined,
    ...(host.openaiBaseURL !== undefined ? { openaiBaseURL: host.openaiBaseURL } : {}),
    ...(host.openaiModel !== undefined ? { openaiModel: host.openaiModel } : {}),
  }
}

export function sanitizeAsrSettingsForClient(raw: unknown): unknown {
  return stripSecrets(cloneJson(raw))
}

export function bindAsrSettings(settingsScope: AsrSettingsBinder): AsrSettingsScope {
  return settingsScope.bind({
    namespace: ASR_SETTINGS_NAMESPACE,
    decode: (section) => readFriendAsrSettings(section),
  })
}

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripSecrets)
  }
  if (!isRecord(value)) {
    return value
  }
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if ((FRIEND_ASR_SECRET_FIELDS as readonly string[]).includes(key)) {
      continue
    }
    out[key] = stripSecrets(child)
  }
  return out
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) {
    return undefined
  }
  return JSON.parse(JSON.stringify(value)) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function createScopeHotkeyStore(scope: AsrSettingsScope): AsrHotkeyStore {
  return {
    get() {
      const snapshot = scope.getSnapshot()
      const value = snapshot.value
      if (value !== undefined && typeof value.hotkey === 'string' && value.hotkey.length > 0) {
        return value.hotkey
      }
      return undefined
    },
    set(spec) {
      return scope.set(ASR_HOTKEY_FIELD, spec)
    },
  }
}
