/**
 * Staged ASR settings form + capability self-check cards.
 */
import type { AsrEngineCapabilities, AsrEnginePreference, AsrListenMode } from './engine.ts'
import {
  ASR_AUTO_SEND_FIELD,
  ASR_BARGE_IN_FIELD,
  ASR_ENGINE_FIELD,
  ASR_LANGUAGE_FIELD,
  ASR_MODE_FIELD,
  ASR_SETTINGS_DEFAULTS,
  ASR_SILENCE_MS_FIELD,
  type AsrSettingsScope,
  type FriendAsrSettings,
} from './settings.ts'

export type AsrSettingsDraft = {
  engine: AsrEnginePreference
  mode: AsrListenMode
  silenceMs: number
  autoSend: boolean
  bargeIn: boolean
  language: string
}

export type AsrCapabilityTone = 'green' | 'gray'

export type AsrCapabilityCard = {
  engineId: 'webspeech' | 'endpoint'
  available: boolean
  tone: AsrCapabilityTone
  title: string
  reason?: string
  guidance?: string
}

export type AsrSettingsForm = {
  getDraft(): AsrSettingsDraft
  getCommitted(): AsrSettingsDraft
  isDirty(): boolean
  set<K extends keyof AsrSettingsDraft>(field: K, value: AsrSettingsDraft[K]): void
  commit(): Promise<void>
  discard(): void
}

export type CreateAsrSettingsFormOptions = {
  scope?: AsrSettingsScope
  snapshot?: FriendAsrSettings
}

export function draftFromAsrSnapshot(snapshot: FriendAsrSettings | undefined): AsrSettingsDraft {
  return {
    engine: snapshot?.engine ?? ASR_SETTINGS_DEFAULTS.engine,
    mode: snapshot?.mode ?? ASR_SETTINGS_DEFAULTS.mode,
    silenceMs: snapshot?.silenceMs ?? ASR_SETTINGS_DEFAULTS.silenceMs,
    autoSend: snapshot?.autoSend ?? ASR_SETTINGS_DEFAULTS.autoSend,
    bargeIn: snapshot?.bargeIn ?? ASR_SETTINGS_DEFAULTS.bargeIn,
    language: snapshot?.language ?? ASR_SETTINGS_DEFAULTS.language,
  }
}

export function createAsrSettingsForm(options: CreateAsrSettingsFormOptions = {}): AsrSettingsForm {
  const readCommitted = (): AsrSettingsDraft => {
    return draftFromAsrSnapshot(options.scope?.getSnapshot().value ?? options.snapshot)
  }
  let committed = readCommitted()
  let draft = { ...committed }

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
      if (options.scope !== undefined) {
        await options.scope.set(ASR_ENGINE_FIELD, next.engine)
        await options.scope.set(ASR_MODE_FIELD, next.mode)
        await options.scope.set(ASR_SILENCE_MS_FIELD, next.silenceMs)
        await options.scope.set(ASR_AUTO_SEND_FIELD, next.autoSend)
        await options.scope.set(ASR_BARGE_IN_FIELD, next.bargeIn)
        await options.scope.set(ASR_LANGUAGE_FIELD, next.language)
      }
      committed = next
      draft = { ...next }
    },
    discard() {
      committed = readCommitted()
      draft = { ...committed }
    },
  }
}

export function renderAsrCapabilityCards(input: {
  webspeech: AsrEngineCapabilities
  endpoint: AsrEngineCapabilities
}): readonly AsrCapabilityCard[] {
  return [
    renderWebSpeechCard(input.webspeech),
    renderEndpointCard(input.webspeech, input.endpoint),
  ]
}

function renderWebSpeechCard(caps: AsrEngineCapabilities): AsrCapabilityCard {
  if (caps.available) {
    return {
      engineId: 'webspeech',
      available: true,
      tone: 'green',
      title: 'Web Speech 可用',
    }
  }
  return {
    engineId: 'webspeech',
    available: false,
    tone: 'gray',
    title: 'Web Speech 不可用',
    ...(caps.reason !== undefined ? { reason: caps.reason } : {}),
    guidance: '请改用自定义 endpoint，或在 Chromium 浏览器中打开',
  }
}

function renderEndpointCard(
  webspeech: AsrEngineCapabilities,
  endpoint: AsrEngineCapabilities,
): AsrCapabilityCard {
  if (endpoint.available) {
    return {
      engineId: 'endpoint',
      available: true,
      tone: 'green',
      title: '自定义 endpoint 可用',
    }
  }
  const bothDown = !webspeech.available
  return {
    engineId: 'endpoint',
    available: false,
    tone: 'gray',
    title: '自定义 endpoint 不可用',
    ...(endpoint.reason !== undefined ? { reason: endpoint.reason } : {}),
    guidance: bothDown
      ? '当前环境没有可用识别引擎。请配置 whisper 兼容端点，或等待后续本地识别。'
      : '可在设置中填写 OpenAI 兼容转写端点作为降级',
  }
}
