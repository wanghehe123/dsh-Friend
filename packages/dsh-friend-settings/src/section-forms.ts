/**
 * Staged drafts for the ten configuration-center panes.
 * Field names match the owning packages' settings documents.
 */
import type { FriendClientSettingsSnapshot } from './project.ts'
import type { ConfigCenterSection } from './sections.ts'

export type SectionControlKind =
  | 'text'
  | 'number'
  | 'range'
  | 'toggle'
  | 'select'
  | 'hotkey'
  | 'secret'
  | 'status'

export type SectionField = {
  key: string
  value: unknown
  kind: SectionControlKind
  disabled?: boolean
  options?: readonly string[]
  min?: number
  max?: number
  step?: number
  placeholder?: string
  labelKey?: string
  hintKey?: string
}

export type SectionFormDescriptor = {
  section: ConfigCenterSection
  fields: readonly SectionField[]
}

export type StagedSectionForm<T extends Record<string, unknown>> = {
  getDraft(): T
  getCommitted(): T
  isDirty(): boolean
  set<K extends keyof T>(field: K, value: T[K]): void
  commit(): Promise<void>
  discard(): void
  descriptor(): SectionFormDescriptor
}

export type SettingsFieldWriter = {
  set(field: string, value: unknown): Promise<void>
}

export type TtsSectionDraft = {
  provider: string
  voice: string
  rate: number
  pitch: number
  autoSpeak: boolean
  stripStageDirections: boolean
  volume: number
  muted: boolean
  openaiApiKey: string
  openaiBaseURL: string
  openaiModel: string
  openaiFormat: string
}

export type AsrSectionDraft = {
  engine: string
  mode: string
  hotkey: string
  silenceMs: number
  bargeIn: boolean
  autoSend: boolean
  language: string
  openaiApiKey: string
  openaiBaseURL: string
  openaiModel: string
}

export type StageSectionDraft = {
  targetFps: number
}

export type MemorySectionDraft = {
  enabled: boolean
  autoSummaryEnabled: boolean
  autoSummaryIdleMinutes: number
  distillHour: number
  distillMinute: number
}

export type GrowthSectionDraft = {
  enabled: boolean
  language: string
}

export type ReactionsSectionDraft = {
  enabled: boolean
  level: string
  globalCooldownMs: number
  kindCooldownMs: number
  toolLongMs: number
  quietHoursText: string
  celebrateProbability: number
}

export type PersonaSectionDraft = {
  currentSlug: string
}

export type FloatSectionDraft = {
  floatEnabled: boolean
  volume: number
  muted: boolean
  floatLeft: number
  floatTop: number
  floatWidth: number
  floatHeight: number
}

export const TTS_PROVIDERS = ['edge', 'dashscope', 'minimax', 'openai-compat', 'browser'] as const
export const HTTP_TTS_PROVIDERS = ['dashscope', 'minimax', 'openai-compat'] as const

export const DASHSCOPE_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
export const DASHSCOPE_DEFAULT_MODEL = 'qwen3-tts-flash'
export const DASHSCOPE_DEFAULT_VOICE = 'Cherry'
export const MINIMAX_DEFAULT_BASE_URL = 'https://api.minimaxi.com/v1'
export const MINIMAX_DEFAULT_MODEL = 'speech-2.8-hd'
export const MINIMAX_DEFAULT_VOICE = 'male-qn-qingse'
export const ASR_ENGINES = ['auto', 'webspeech', 'endpoint'] as const
export const ASR_MODES = ['hold', 'toggle', 'auto'] as const
export const REACTION_LEVELS = ['action', 'bubble', 'voice'] as const

export const EDGE_VOICE_IDS = [
  'zh-CN-XiaoxiaoNeural',
  'zh-CN-YunxiNeural',
  'zh-CN-XiaoyiNeural',
  'en-US-AriaNeural',
  'en-US-GuyNeural',
] as const

export const OPENAI_VOICE_IDS = [
  'alloy',
  'echo',
  'fable',
  'onyx',
  'nova',
  'shimmer',
] as const

/** OpenAI `/audio/speech` `response_format` values (and CosyVoice-compatible aliases). */
export const OPENAI_AUDIO_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] as const

const DEFAULT_FLOAT_WIDTH = 280
const DEFAULT_FLOAT_HEIGHT = 360

type CreateStagedOptions<T extends Record<string, unknown>> = {
  writer?: SettingsFieldWriter
  writes?: (draft: T) => ReadonlyArray<readonly [string, unknown]>
  describe?: (draft: T) => readonly SectionField[]
}

function createStaged<T extends Record<string, unknown>>(
  section: ConfigCenterSection,
  initial: T,
  options: CreateStagedOptions<T> = {},
): StagedSectionForm<T> {
  let committed = { ...initial }
  let draft = { ...initial }
  return {
    getDraft() {
      return { ...draft }
    },
    getCommitted() {
      return { ...committed }
    },
    isDirty() {
      return JSON.stringify(draft) !== JSON.stringify(committed)
    },
    set(field, value) {
      draft = { ...draft, [field]: value }
    },
    async commit() {
      const next = { ...draft }
      if (options.writer !== undefined) {
        const entries = options.writes?.(next) ?? Object.entries(next)
        for (const [key, value] of entries) {
          await options.writer.set(key, value)
        }
      }
      committed = next
      draft = { ...next }
    },
    discard() {
      draft = { ...committed }
    },
    descriptor() {
      return {
        section,
        fields: options.describe?.(draft) ?? Object.entries(draft).map(([key, value]) => ({
          key,
          value,
          kind: inferKind(value),
        })),
      }
    },
  }
}

function inferKind(value: unknown): SectionControlKind {
  if (typeof value === 'boolean') {
    return 'toggle'
  }
  if (typeof value === 'number') {
    return 'number'
  }
  return 'text'
}

export function voicesForProvider(provider: string, current: string): readonly string[] {
  const catalog: readonly string[] = provider === 'openai-compat'
    ? OPENAI_VOICE_IDS
    : provider === 'browser'
      ? []
      : EDGE_VOICE_IDS
  if (current.length > 0 && !catalog.includes(current)) {
    return [current, ...catalog]
  }
  return [...catalog]
}

export function formatsForOpenAi(current: string): readonly string[] {
  const catalog: readonly string[] = [...OPENAI_AUDIO_FORMATS]
  if (current.length > 0 && !catalog.includes(current)) {
    return [current, ...catalog]
  }
  return catalog
}

function isHttpTtsProvider(provider: string): boolean {
  return (HTTP_TTS_PROVIDERS as readonly string[]).includes(provider)
}

function ttsVoiceHintKey(provider: string): string {
  if (provider === 'dashscope') {
    return 'tts.voiceHintDashscope'
  }
  if (provider === 'minimax') {
    return 'tts.voiceHintMinimax'
  }
  return 'tts.voiceHint'
}

function ttsVoiceField(draft: TtsSectionDraft): SectionField {
  if (isHttpTtsProvider(draft.provider)) {
    return {
      key: 'voice',
      value: draft.voice,
      kind: 'text',
      placeholder: ttsVoiceHintKey(draft.provider),
    }
  }
  return {
    key: 'voice',
    value: draft.voice,
    kind: 'select',
    options: voicesForProvider(draft.provider, draft.voice),
  }
}

function ttsEndpointFields(draft: TtsSectionDraft): readonly SectionField[] {
  const labels = ttsEndpointLabelKeys(draft.provider)
  return [
    {
      key: 'openaiApiKey',
      value: draft.openaiApiKey,
      kind: 'secret',
      labelKey: labels.apiKey,
      hintKey: labels.hint,
    },
    {
      key: 'openaiBaseURL',
      value: draft.openaiBaseURL,
      kind: 'text',
      labelKey: labels.baseURL,
      placeholder: labels.urlPlaceholder,
    },
    {
      key: 'openaiModel',
      value: draft.openaiModel,
      kind: 'text',
      labelKey: labels.model,
    },
    {
      key: 'openaiFormat',
      value: draft.openaiFormat,
      kind: 'select',
      labelKey: 'tts.audioFormat',
      options: formatsForOpenAi(draft.openaiFormat),
    },
  ]
}

function ttsEndpointLabelKeys(provider: string): {
  apiKey: string
  hint: string
  baseURL: string
  model: string
  urlPlaceholder: string
} {
  if (provider === 'dashscope') {
    return {
      apiKey: 'tts.dashscopeApiKey',
      hint: 'tts.dashscopeApiKeyHint',
      baseURL: 'tts.dashscopeBaseURL',
      model: 'tts.dashscopeModel',
      urlPlaceholder: DASHSCOPE_DEFAULT_BASE_URL,
    }
  }
  if (provider === 'minimax') {
    return {
      apiKey: 'tts.minimaxApiKey',
      hint: 'tts.minimaxApiKeyHint',
      baseURL: 'tts.minimaxBaseURL',
      model: 'tts.minimaxModel',
      urlPlaceholder: MINIMAX_DEFAULT_BASE_URL,
    }
  }
  return {
    apiKey: 'tts.openaiApiKey',
    hint: 'tts.openaiApiKeyHint',
    baseURL: 'tts.openaiBaseURL',
    model: 'tts.openaiModel',
    urlPlaceholder: 'https://api.siliconflow.cn/v1',
  }
}

function defaultTtsVoice(provider: string): string {
  if (provider === 'dashscope') {
    return DASHSCOPE_DEFAULT_VOICE
  }
  if (provider === 'minimax') {
    return MINIMAX_DEFAULT_VOICE
  }
  if (provider === 'openai-compat') {
    return 'alloy'
  }
  return 'zh-CN-XiaoxiaoNeural'
}

function defaultTtsBaseURL(provider: string): string {
  if (provider === 'dashscope') {
    return DASHSCOPE_DEFAULT_BASE_URL
  }
  if (provider === 'minimax') {
    return MINIMAX_DEFAULT_BASE_URL
  }
  return ''
}

function defaultTtsModel(provider: string): string {
  if (provider === 'dashscope') {
    return DASHSCOPE_DEFAULT_MODEL
  }
  if (provider === 'minimax') {
    return MINIMAX_DEFAULT_MODEL
  }
  return ''
}

export function applyTtsProviderDefaults(draft: TtsSectionDraft, provider: string): TtsSectionDraft {
  const next = { ...draft, provider }
  if (provider === 'dashscope') {
    if (isForeignTtsUrl(next.openaiBaseURL, 'dashscope')) {
      next.openaiBaseURL = DASHSCOPE_DEFAULT_BASE_URL
    }
    if (isForeignTtsModel(next.openaiModel, 'dashscope')) {
      next.openaiModel = DASHSCOPE_DEFAULT_MODEL
    }
    if (isForeignTtsVoice(next.voice, 'dashscope')) {
      next.voice = DASHSCOPE_DEFAULT_VOICE
    }
    return next
  }
  if (provider === 'minimax') {
    if (isForeignTtsUrl(next.openaiBaseURL, 'minimax')) {
      next.openaiBaseURL = MINIMAX_DEFAULT_BASE_URL
    }
    if (isForeignTtsModel(next.openaiModel, 'minimax')) {
      next.openaiModel = MINIMAX_DEFAULT_MODEL
    }
    if (isForeignTtsVoice(next.voice, 'minimax')) {
      next.voice = MINIMAX_DEFAULT_VOICE
    }
    return next
  }
  if (provider === 'openai-compat') {
    if (isForeignTtsUrl(next.openaiBaseURL, 'openai')) {
      next.openaiBaseURL = ''
    }
    if (isForeignTtsVoice(next.voice, 'openai')) {
      next.voice = 'alloy'
    }
    return next
  }
  if (provider === 'edge' && isForeignTtsVoice(next.voice, 'edge')) {
    next.voice = 'zh-CN-XiaoxiaoNeural'
  }
  return next
}

function isForeignTtsUrl(url: string, target: 'dashscope' | 'minimax' | 'openai'): boolean {
  if (url.length === 0) {
    return target !== 'openai'
  }
  if (target === 'dashscope') {
    return !url.includes('dashscope')
  }
  if (target === 'minimax') {
    return !url.includes('minimax')
  }
  return url.includes('dashscope') || url.includes('minimax')
}

function isForeignTtsModel(model: string, target: 'dashscope' | 'minimax'): boolean {
  if (model.length === 0) {
    return true
  }
  if (target === 'dashscope') {
    return /^(tts-1|speech-|gpt-4o)/u.test(model)
  }
  return /^(qwen|cosyvoice|tts-1|gpt-4o)/u.test(model)
}

function isForeignTtsVoice(voice: string, target: 'dashscope' | 'minimax' | 'openai' | 'edge'): boolean {
  if (voice.length === 0) {
    return true
  }
  const edge = (EDGE_VOICE_IDS as readonly string[]).includes(voice)
  const openai = (OPENAI_VOICE_IDS as readonly string[]).includes(voice)
  const dashscope = voice === 'Cherry' || voice === 'Serena' || voice === 'Ethan' || voice === 'Chelsie'
  const minimax = voice === MINIMAX_DEFAULT_VOICE || voice === 'female-shaonv' || voice.includes('Mandarin')
  if (target === 'dashscope') {
    return edge || openai || minimax
  }
  if (target === 'minimax') {
    return edge || openai || dashscope
  }
  if (target === 'openai') {
    return edge || dashscope || minimax
  }
  return openai || dashscope || minimax
}

export function formatQuietHoursText(value: unknown): string {
  if (!Array.isArray(value)) {
    return ''
  }
  const parts: string[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const record = item as Record<string, unknown>
    if (typeof record.start === 'string' && typeof record.end === 'string') {
      parts.push(`${record.start}-${record.end}`)
    }
  }
  return parts.join(', ')
}

export function parseQuietHoursText(text: string): ReadonlyArray<{ start: string; end: string }> {
  const windows: Array<{ start: string; end: string }> = []
  for (const part of text.split(/[,;\n]/u)) {
    const trimmed = part.trim()
    if (trimmed.length === 0) {
      continue
    }
    const match = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/u.exec(trimmed)
    if (match?.[1] !== undefined && match[2] !== undefined) {
      windows.push({ start: match[1], end: match[2] })
    }
  }
  return windows
}

function physicalKeyFromEvent(event: { key: string; code?: string }): string {
  const code = event.code
  if (typeof code === 'string') {
    if (/^Key[A-Z]$/u.test(code)) {
      return code.slice(3).toLowerCase()
    }
    if (/^Digit[0-9]$/u.test(code)) {
      return code.slice(5)
    }
  }
  const key = event.key
  if (key.length === 1) {
    return key.toLowerCase()
  }
  return key
}

export function formatHotkeyFromEvent(event: {
  key: string
  code?: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}): string | undefined {
  const key = event.key
  if (
    key === 'Control'
    || key === 'Alt'
    || key === 'Shift'
    || key === 'Meta'
    || key === 'Escape'
    || key === 'Tab'
  ) {
    return undefined
  }
  if (event.ctrlKey !== true && event.altKey !== true && event.metaKey !== true) {
    return undefined
  }
  const parts: string[] = []
  if (event.ctrlKey === true) {
    parts.push('Ctrl')
  }
  if (event.altKey === true) {
    parts.push('Alt')
  }
  if (event.shiftKey === true) {
    parts.push('Shift')
  }
  if (event.metaKey === true) {
    parts.push('Meta')
  }
  const token = physicalKeyFromEvent(event)
  parts.push(token.length === 1 ? token.toUpperCase() : token)
  return parts.join('+')
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function ttsWrites(draft: TtsSectionDraft): ReadonlyArray<readonly [string, unknown]> {
  const entries: Array<readonly [string, unknown]> = [
    ['provider', draft.provider],
    ['voice', draft.voice],
    ['rate', draft.rate],
    ['pitch', draft.pitch],
    ['autoSpeak', draft.autoSpeak],
    ['stripStageDirections', draft.stripStageDirections],
    ['volume', draft.volume],
    ['muted', draft.muted],
    ['openaiBaseURL', draft.openaiBaseURL],
    ['openaiModel', draft.openaiModel],
    ['openaiFormat', draft.openaiFormat],
  ]
  if (draft.openaiApiKey.trim().length > 0) {
    entries.push(['openaiApiKey', draft.openaiApiKey])
  }
  return entries
}

function asrWrites(draft: AsrSectionDraft): ReadonlyArray<readonly [string, unknown]> {
  const entries: Array<readonly [string, unknown]> = [
    ['engine', draft.engine],
    ['mode', draft.mode],
    ['hotkey', draft.hotkey],
    ['silenceMs', draft.silenceMs],
    ['bargeIn', draft.bargeIn],
    ['autoSend', draft.autoSend],
    ['language', draft.language],
    ['openaiBaseURL', draft.openaiBaseURL],
    ['openaiModel', draft.openaiModel],
  ]
  if (draft.openaiApiKey.trim().length > 0) {
    entries.push(['openaiApiKey', draft.openaiApiKey])
  }
  return entries
}

export function createTtsSectionForm(
  snapshot: FriendClientSettingsSnapshot['tts'],
  writer?: SettingsFieldWriter,
): StagedSectionForm<TtsSectionDraft> {
  const provider = asString(snapshot.provider, 'edge')
  const initial: TtsSectionDraft = {
    provider,
    voice: asString(snapshot.voice, defaultTtsVoice(provider)),
    rate: asNumber(snapshot.rate, 1),
    pitch: asNumber(snapshot.pitch, 1),
    autoSpeak: asBoolean(snapshot.autoSpeak, true),
    stripStageDirections: asBoolean(snapshot.stripStageDirections, true),
    volume: asNumber(snapshot.volume, 1),
    muted: asBoolean(snapshot.muted, false),
    openaiApiKey: '',
    openaiBaseURL: asString(snapshot.openaiBaseURL, defaultTtsBaseURL(provider)),
    openaiModel: asString(snapshot.openaiModel, defaultTtsModel(provider)),
    openaiFormat: asString(snapshot.openaiFormat, 'mp3'),
  }
  const form = createStaged('tts', initial, {
    ...(writer !== undefined ? { writer } : {}),
    writes(draft) {
      return ttsWrites(draft)
    },
    describe(draft) {
      return [
        { key: 'provider', value: draft.provider, kind: 'select', options: TTS_PROVIDERS },
        ttsVoiceField(draft),
        { key: 'rate', value: draft.rate, kind: 'range', min: 0.5, max: 2, step: 0.05 },
        { key: 'pitch', value: draft.pitch, kind: 'range', min: 0.5, max: 2, step: 0.05 },
        { key: 'autoSpeak', value: draft.autoSpeak, kind: 'toggle' },
        { key: 'stripStageDirections', value: draft.stripStageDirections, kind: 'toggle' },
        { key: 'volume', value: draft.volume, kind: 'range', min: 0, max: 1, step: 0.05 },
        { key: 'muted', value: draft.muted, kind: 'toggle' },
        ...ttsEndpointFields(draft),
      ]
    },
  })
  const setField = form.set.bind(form)
  return {
    ...form,
    set(field, value) {
      if (field === 'provider' && typeof value === 'string') {
        const next = applyTtsProviderDefaults(form.getDraft(), value)
        setField('provider', next.provider)
        setField('voice', next.voice)
        setField('openaiBaseURL', next.openaiBaseURL)
        setField('openaiModel', next.openaiModel)
        return
      }
      setField(field, value)
    },
  }
}

export function createAsrSectionForm(
  snapshot: FriendClientSettingsSnapshot['asr'],
  writer?: SettingsFieldWriter,
): StagedSectionForm<AsrSectionDraft> {
  const initial: AsrSectionDraft = {
    engine: asString(snapshot.engine, 'auto'),
    mode: asString(snapshot.mode, 'hold'),
    hotkey: asString(snapshot.hotkey, 'Alt+S'),
    silenceMs: asNumber(snapshot.silenceMs, 1200),
    bargeIn: asBoolean(snapshot.bargeIn, true),
    autoSend: asBoolean(snapshot.autoSend, true),
    language: asString(snapshot.language, 'zh-CN'),
    openaiApiKey: '',
    openaiBaseURL: asString(snapshot.openaiBaseURL, ''),
    openaiModel: asString(snapshot.openaiModel, ''),
  }
  return createStaged('asr', initial, {
    ...(writer !== undefined ? { writer } : {}),
    writes(draft) {
      return asrWrites(draft)
    },
    describe(draft) {
      return [
        { key: 'engine', value: draft.engine, kind: 'select', options: ASR_ENGINES },
        { key: 'mode', value: draft.mode, kind: 'select', options: ASR_MODES },
        { key: 'hotkey', value: draft.hotkey, kind: 'hotkey' },
        { key: 'silenceMs', value: draft.silenceMs, kind: 'number', min: 200, max: 10_000, step: 100 },
        { key: 'bargeIn', value: draft.bargeIn, kind: 'toggle' },
        { key: 'autoSend', value: draft.autoSend, kind: 'toggle' },
        { key: 'language', value: draft.language, kind: 'text' },
        { key: 'openaiApiKey', value: draft.openaiApiKey, kind: 'secret' },
        { key: 'openaiBaseURL', value: draft.openaiBaseURL, kind: 'text' },
        { key: 'openaiModel', value: draft.openaiModel, kind: 'text' },
      ]
    },
  })
}

export function createStageSectionForm(
  snapshot: FriendClientSettingsSnapshot['stage'],
  writer?: SettingsFieldWriter,
): StagedSectionForm<StageSectionDraft> {
  return createStaged('stage', { targetFps: snapshot.targetFps }, {
    ...(writer !== undefined ? { writer } : {}),
    describe(draft) {
      return [
        { key: 'targetFps', value: draft.targetFps, kind: 'number', min: 1, max: 120, step: 1 },
      ]
    },
  })
}

export function createMemorySectionForm(
  snapshot: FriendClientSettingsSnapshot['memory'],
  writer?: SettingsFieldWriter,
): StagedSectionForm<MemorySectionDraft> {
  return createStaged('memory', {
    enabled: snapshot.enabled,
    autoSummaryEnabled: snapshot.autoSummaryEnabled,
    autoSummaryIdleMinutes: snapshot.autoSummaryIdleMinutes,
    distillHour: snapshot.distillHour,
    distillMinute: snapshot.distillMinute,
  }, {
    ...(writer !== undefined ? { writer } : {}),
    describe(draft) {
      return [
        { key: 'enabled', value: draft.enabled, kind: 'toggle' },
        { key: 'autoSummaryEnabled', value: draft.autoSummaryEnabled, kind: 'toggle' },
        {
          key: 'autoSummaryIdleMinutes',
          value: draft.autoSummaryIdleMinutes,
          kind: 'number',
          min: 1,
          max: 24 * 60,
          step: 1,
        },
        { key: 'distillHour', value: draft.distillHour, kind: 'number', min: 0, max: 23, step: 1 },
        { key: 'distillMinute', value: draft.distillMinute, kind: 'number', min: 0, max: 59, step: 1 },
      ]
    },
  })
}

export function createGrowthSectionForm(
  snapshot: FriendClientSettingsSnapshot['growth'],
  writer?: SettingsFieldWriter,
): StagedSectionForm<GrowthSectionDraft> {
  return createStaged('growth', {
    enabled: snapshot.enabled,
    language: snapshot.language,
  }, {
    ...(writer !== undefined ? { writer } : {}),
    describe(draft) {
      return [
        { key: 'enabled', value: draft.enabled, kind: 'toggle' },
        { key: 'language', value: draft.language, kind: 'text' },
      ]
    },
  })
}

export function createReactionsSectionForm(
  snapshot: FriendClientSettingsSnapshot['reactions'],
  writer?: SettingsFieldWriter,
): StagedSectionForm<ReactionsSectionDraft> {
  return createStaged('reactions', {
    enabled: snapshot.enabled,
    level: snapshot.level,
    globalCooldownMs: snapshot.globalCooldownMs,
    kindCooldownMs: snapshot.kindCooldownMs,
    toolLongMs: snapshot.toolLongMs,
    quietHoursText: formatQuietHoursText(snapshot.quietHours),
    celebrateProbability: snapshot.celebrateProbability,
  }, {
    ...(writer !== undefined ? { writer } : {}),
    writes(draft) {
      return [
        ['enabled', draft.enabled],
        ['level', draft.level],
        ['globalCooldownMs', draft.globalCooldownMs],
        ['kindCooldownMs', draft.kindCooldownMs],
        ['toolLongMs', draft.toolLongMs],
        ['quietHours', parseQuietHoursText(draft.quietHoursText)],
        ['celebrateProbability', draft.celebrateProbability],
      ]
    },
    describe(draft) {
      return [
        { key: 'enabled', value: draft.enabled, kind: 'toggle' },
        { key: 'level', value: draft.level, kind: 'select', options: REACTION_LEVELS },
        { key: 'globalCooldownMs', value: draft.globalCooldownMs, kind: 'number', min: 0, max: 3_600_000, step: 1000 },
        { key: 'kindCooldownMs', value: draft.kindCooldownMs, kind: 'number', min: 0, max: 3_600_000, step: 1000 },
        { key: 'toolLongMs', value: draft.toolLongMs, kind: 'number', min: 1000, max: 600_000, step: 1000 },
        { key: 'quietHoursText', value: draft.quietHoursText, kind: 'text' },
        { key: 'celebrateProbability', value: draft.celebrateProbability, kind: 'range', min: 0, max: 1, step: 0.05 },
      ]
    },
  })
}

export function createPersonaSectionForm(
  snapshot: FriendClientSettingsSnapshot['persona'],
  options: { writer?: SettingsFieldWriter; characters?: readonly string[] } = {},
): StagedSectionForm<PersonaSectionDraft> {
  const current = snapshot.currentSlug
  const characters = options.characters ?? []
  const slugs = characters.includes(current) ? characters : [current, ...characters]
  return createStaged('persona', { currentSlug: current }, {
    ...(options.writer !== undefined ? { writer: options.writer } : {}),
    describe(draft) {
      return [
        characters.length > 0
          ? { key: 'currentSlug', value: draft.currentSlug, kind: 'select', options: slugs }
          : { key: 'currentSlug', value: draft.currentSlug, kind: 'text' },
      ]
    },
  })
}

export function createFloatSectionForm(
  core: FriendClientSettingsSnapshot['core'],
  stage: FriendClientSettingsSnapshot['stage'],
  writers: { core?: SettingsFieldWriter; stage?: SettingsFieldWriter; tts?: SettingsFieldWriter } = {},
  tts?: FriendClientSettingsSnapshot['tts'],
): StagedSectionForm<FloatSectionDraft> {
  const playbackVolume = asNumber(tts?.volume, core.volume)
  const playbackMuted = asBoolean(tts?.muted, core.muted)
  const initial: FloatSectionDraft = {
    floatEnabled: core.floatEnabled,
    volume: playbackVolume,
    muted: playbackMuted,
    floatLeft: stage.floatLeft ?? 0,
    floatTop: stage.floatTop ?? 0,
    floatWidth: stage.floatWidth,
    floatHeight: stage.floatHeight,
  }
  let committed = { ...initial }
  let draft = { ...initial }
  return {
    getDraft() {
      return { ...draft }
    },
    getCommitted() {
      return { ...committed }
    },
    isDirty() {
      return JSON.stringify(draft) !== JSON.stringify(committed)
    },
    set(field, value) {
      draft = { ...draft, [field]: value }
    },
    async commit() {
      const next = { ...draft }
      if (writers.tts !== undefined) {
        await writers.tts.set('volume', next.volume)
        await writers.tts.set('muted', next.muted)
      }
      if (writers.core !== undefined) {
        await writers.core.set('floatEnabled', next.floatEnabled)
        await writers.core.set('volume', next.volume)
        await writers.core.set('muted', next.muted)
      }
      if (writers.stage !== undefined) {
        await writers.stage.set('floatLeft', next.floatLeft)
        await writers.stage.set('floatTop', next.floatTop)
        await writers.stage.set('floatWidth', next.floatWidth)
        await writers.stage.set('floatHeight', next.floatHeight)
      }
      committed = next
      draft = { ...next }
    },
    discard() {
      draft = { ...committed }
    },
    descriptor() {
      return {
        section: 'float',
        fields: [
          { key: 'floatEnabled', value: draft.floatEnabled, kind: 'toggle' },
          { key: 'volume', value: draft.volume, kind: 'range', min: 0, max: 1, step: 0.05 },
          { key: 'muted', value: draft.muted, kind: 'toggle' },
          { key: 'floatLeft', value: draft.floatLeft, kind: 'number', step: 1 },
          { key: 'floatTop', value: draft.floatTop, kind: 'number', step: 1 },
          { key: 'floatWidth', value: draft.floatWidth, kind: 'number', min: 160, max: 1200, step: 1 },
          { key: 'floatHeight', value: draft.floatHeight, kind: 'number', min: 200, max: 1600, step: 1 },
        ],
      }
    },
  }
}

export function describeAllSections(snapshot: FriendClientSettingsSnapshot): readonly SectionFormDescriptor[] {
  return [
    { section: 'model', fields: [] },
    createPersonaSectionForm(snapshot.persona).descriptor(),
    createTtsSectionForm(snapshot.tts).descriptor(),
    createAsrSectionForm(snapshot.asr).descriptor(),
    createStageSectionForm(snapshot.stage).descriptor(),
    createMemorySectionForm(snapshot.memory).descriptor(),
    createGrowthSectionForm(snapshot.growth).descriptor(),
    createReactionsSectionForm(snapshot.reactions).descriptor(),
    createFloatSectionForm(snapshot.core, snapshot.stage, {}, snapshot.tts).descriptor(),
    { section: 'about', fields: [] },
  ]
}

export { DEFAULT_FLOAT_WIDTH, DEFAULT_FLOAT_HEIGHT }
