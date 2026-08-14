/**
 * Host vs client views of the `friend-tts` settings document.
 *
 * The openai-compat API key lives only in the host document. Client-readable
 * snapshots are produced by {@link toClientTtsSnapshot} / {@link sanitizeTtsSettingsForClient}
 * and MUST drop every secret field. Do not put `apiKey` on synthesize opts.
 */
import { FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared/universal'

export const TTS_SETTINGS_NAMESPACE = FRIEND_SETTINGS_NAMESPACES.tts

/** Field names that must never appear on a client-readable snapshot. */
export const FRIEND_TTS_SECRET_FIELDS = [
  'apiKey',
  'openaiApiKey',
  'authorization',
  'Authorization',
] as const

export type FriendTtsSecretField = (typeof FRIEND_TTS_SECRET_FIELDS)[number]

export const TTS_PROVIDER_FIELD = 'provider'
export const TTS_VOICE_FIELD = 'voice'
export const TTS_RATE_FIELD = 'rate'
export const TTS_PITCH_FIELD = 'pitch'
export const TTS_AUTO_SPEAK_FIELD = 'autoSpeak'
export const TTS_STRIP_STAGE_FIELD = 'stripStageDirections'
/**
 * Unique playback source of truth.
 *
 * `friend-tts.volume` / `friend-tts.muted` are the only fields
 * {@link readTtsPlayback} (and therefore AudioContext + speechSynthesis)
 * reads. `friend-core.volume` / `friend-core.muted` and
 * `friend-stage.floatMuted` are write-through aliases maintained by the
 * settings mute bridge so the tray, float menu, and config center stay
 * aligned. Do not introduce a fourth mute field.
 */
export const TTS_VOLUME_FIELD = 'volume'
export const TTS_MUTED_FIELD = 'muted'
export const TTS_OPENAI_API_KEY_FIELD = 'openaiApiKey'
export const TTS_OPENAI_BASE_URL_FIELD = 'openaiBaseURL'
export const TTS_OPENAI_MODEL_FIELD = 'openaiModel'
export const TTS_OPENAI_FORMAT_FIELD = 'openaiFormat'

export interface FriendTtsHostSettings {
  provider?: string
  voice?: string
  rate?: number
  pitch?: number
  autoSpeak?: boolean
  stripStageDirections?: boolean
  volume?: number
  muted?: boolean
  openaiApiKey?: string
  openaiBaseURL?: string
  openaiModel?: string
  openaiFormat?: string
}

/**
 * Client-safe view of TTS settings. `hasApiKey` is a boolean flag only —
 * the key material itself is never copied here.
 */
export interface FriendTtsClientSnapshot {
  provider?: string
  voice?: string
  rate?: number
  pitch?: number
  autoSpeak?: boolean
  stripStageDirections?: boolean
  volume?: number
  muted?: boolean
  openaiBaseURL?: string
  openaiModel?: string
  openaiFormat?: string
  hasApiKey: boolean
}

export type TtsSettingsScope = {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value: FriendTtsClientSnapshot | undefined
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

export type TtsSettingsBinder = {
  bind(spec: {
    namespace: typeof TTS_SETTINGS_NAMESPACE
    decode?: (section: unknown) => FriendTtsClientSnapshot | undefined
  }): TtsSettingsScope
}

export function readFriendTtsHostSettings(raw: unknown): FriendTtsHostSettings {
  if (!isRecord(raw)) {
    return {}
  }
  const nested = isRecord(raw.openai) ? raw.openai : undefined
  const settings: FriendTtsHostSettings = {}
  assignString(settings, 'provider', asNonEmptyString(raw.provider))
  assignString(settings, 'voice', asNonEmptyString(raw.voice))
  assignNumber(settings, 'rate', asFiniteNumber(raw.rate))
  assignNumber(settings, 'pitch', asFiniteNumber(raw.pitch))
  assignBoolean(settings, 'autoSpeak', asBoolean(raw.autoSpeak))
  assignBoolean(settings, 'stripStageDirections', asBoolean(raw.stripStageDirections))
  assignNumber(settings, 'volume', asFiniteNumber(raw.volume))
  assignBoolean(settings, 'muted', asBoolean(raw.muted))
  assignString(
    settings,
    'openaiApiKey',
    asNonEmptyString(raw.openaiApiKey)
      ?? asNonEmptyString(raw.apiKey)
      ?? (nested !== undefined ? asNonEmptyString(nested.apiKey) : undefined),
  )
  assignString(
    settings,
    'openaiBaseURL',
    asNonEmptyString(raw.openaiBaseURL)
      ?? asNonEmptyString(raw.baseURL)
      ?? (nested !== undefined ? asNonEmptyString(nested.baseURL) : undefined),
  )
  assignString(
    settings,
    'openaiModel',
    asNonEmptyString(raw.openaiModel)
      ?? (nested !== undefined ? asNonEmptyString(nested.model) : undefined),
  )
  assignString(
    settings,
    'openaiFormat',
    asNonEmptyString(raw.openaiFormat)
      ?? asNonEmptyString(raw.format)
      ?? (nested !== undefined ? asNonEmptyString(nested.format) : undefined),
  )
  return settings
}

/**
 * The only client-readable projection of a host TTS document.
 * Secret fields are dropped; `hasApiKey` records presence without material.
 */
export function toClientTtsSnapshot(raw: unknown): FriendTtsClientSnapshot {
  const host = readFriendTtsHostSettings(raw)
  const snapshot: FriendTtsClientSnapshot = {
    hasApiKey: host.openaiApiKey !== undefined,
  }
  assignString(snapshot, 'provider', host.provider)
  assignString(snapshot, 'voice', host.voice)
  assignNumber(snapshot, 'rate', host.rate)
  assignNumber(snapshot, 'pitch', host.pitch)
  assignBoolean(snapshot, 'autoSpeak', host.autoSpeak)
  assignBoolean(snapshot, 'stripStageDirections', host.stripStageDirections)
  assignNumber(snapshot, 'volume', host.volume)
  assignBoolean(snapshot, 'muted', host.muted)
  assignString(snapshot, 'openaiBaseURL', host.openaiBaseURL)
  assignString(snapshot, 'openaiModel', host.openaiModel)
  assignString(snapshot, 'openaiFormat', host.openaiFormat)
  return snapshot
}

/**
 * Deep-clone `raw` and delete every secret field (including nested
 * `openai.apiKey`). Used as the client `settingsScope` decode so `value`
 * cannot carry key material even if the host document did.
 */
export function sanitizeTtsSettingsForClient(raw: unknown): unknown {
  return stripSecrets(cloneJson(raw))
}

export function bindTtsSettings(settingsScope: TtsSettingsBinder): TtsSettingsScope {
  return settingsScope.bind({
    namespace: TTS_SETTINGS_NAMESPACE,
    decode: (section) => toClientTtsSnapshot(section),
  })
}

/** Live playback knobs. Missing fields use the form defaults (speak on, full volume). */
export function readTtsPlayback(snapshot: FriendTtsClientSnapshot | undefined): {
  volume: number
  muted: boolean
  autoSpeak: boolean
} {
  return {
    volume: snapshot?.volume ?? 1,
    muted: snapshot?.muted === true,
    autoSpeak: snapshot?.autoSpeak !== false,
  }
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
    if (isSecretField(key)) {
      continue
    }
    out[key] = stripSecrets(child)
  }
  return out
}

function isSecretField(key: string): boolean {
  return (FRIEND_TTS_SECRET_FIELDS as readonly string[]).includes(key)
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

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function assignString<K extends string>(
  target: Record<K, string | undefined> | object,
  key: K,
  value: string | undefined,
): void {
  if (value !== undefined) {
    (target as Record<K, string>)[key] = value
  }
}

function assignNumber<K extends string>(
  target: Record<K, number | undefined> | object,
  key: K,
  value: number | undefined,
): void {
  if (value !== undefined) {
    (target as Record<K, number>)[key] = value
  }
}

function assignBoolean<K extends string>(
  target: Record<K, boolean | undefined> | object,
  key: K,
  value: boolean | undefined,
): void {
  if (value !== undefined) {
    (target as Record<K, boolean>)[key] = value
  }
}
