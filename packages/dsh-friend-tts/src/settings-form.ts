/**
 * Staged TTS settings form. Draft edits stay local until `commit()`;
 * `preview()` always uses the draft voice/rate/pitch so a change is audible
 * before save.
 */
import { FRIEND_TTS_PREVIEW_SENTENCE } from './preview-sentence.ts'
import {
  TTS_AUTO_SPEAK_FIELD,
  TTS_MUTED_FIELD,
  TTS_PITCH_FIELD,
  TTS_PROVIDER_FIELD,
  TTS_RATE_FIELD,
  TTS_STRIP_STAGE_FIELD,
  TTS_VOICE_FIELD,
  TTS_VOLUME_FIELD,
  type FriendTtsClientSnapshot,
  type TtsSettingsScope,
} from './settings.ts'
import { listCatalogVoices } from './voices.ts'
import type { FriendTtsVoice } from './seam.ts'

export { TTS_AUTO_SPEAK_FIELD, TTS_MUTED_FIELD, TTS_STRIP_STAGE_FIELD, TTS_VOLUME_FIELD }

export type TtsSettingsDraft = {
  provider: string
  voice: string
  rate: number
  pitch: number
  autoSpeak: boolean
  stripStageDirections: boolean
  volume: number
  muted: boolean
}

export const TTS_SETTINGS_FORM_DEFAULTS: TtsSettingsDraft = {
  provider: 'edge',
  voice: 'zh-CN-XiaoxiaoNeural',
  rate: 1,
  pitch: 1,
  autoSpeak: true,
  stripStageDirections: true,
  volume: 1,
  muted: false,
}

export type TtsSettingsForm = {
  getDraft(): TtsSettingsDraft
  getCommitted(): TtsSettingsDraft
  isDirty(): boolean
  set<K extends keyof TtsSettingsDraft>(field: K, value: TtsSettingsDraft[K]): void
  listVoices(): readonly FriendTtsVoice[]
  previewSentence(): string
  preview(): Promise<void>
  commit(): Promise<void>
  discard(): void
}

export type CreateTtsSettingsFormOptions = {
  scope?: TtsSettingsScope
  snapshot?: FriendTtsClientSnapshot
  listVoices?: (provider: string) => readonly FriendTtsVoice[]
  onPreview?: (draft: TtsSettingsDraft, sentence: string) => void | Promise<void>
}

export function draftFromTtsSnapshot(snapshot: FriendTtsClientSnapshot | undefined): TtsSettingsDraft {
  return {
    provider: snapshot?.provider ?? TTS_SETTINGS_FORM_DEFAULTS.provider,
    voice: snapshot?.voice ?? TTS_SETTINGS_FORM_DEFAULTS.voice,
    rate: snapshot?.rate ?? TTS_SETTINGS_FORM_DEFAULTS.rate,
    pitch: snapshot?.pitch ?? TTS_SETTINGS_FORM_DEFAULTS.pitch,
    autoSpeak: snapshot?.autoSpeak ?? TTS_SETTINGS_FORM_DEFAULTS.autoSpeak,
    stripStageDirections: snapshot?.stripStageDirections ?? TTS_SETTINGS_FORM_DEFAULTS.stripStageDirections,
    volume: snapshot?.volume ?? TTS_SETTINGS_FORM_DEFAULTS.volume,
    muted: snapshot?.muted ?? TTS_SETTINGS_FORM_DEFAULTS.muted,
  }
}

export function createTtsSettingsForm(options: CreateTtsSettingsFormOptions = {}): TtsSettingsForm {
  const readCommitted = (): TtsSettingsDraft => {
    const value = options.scope?.getSnapshot().value ?? options.snapshot
    return draftFromTtsSnapshot(value)
  }

  let committed = readCommitted()
  let draft = { ...committed }

  const listVoices = (provider: string): readonly FriendTtsVoice[] => {
    return options.listVoices?.(provider) ?? listCatalogVoices(provider)
  }

  return {
    getDraft() {
      return { ...draft }
    },
    getCommitted() {
      return { ...committed }
    },
    isDirty() {
      return !draftsEqual(draft, committed)
    },
    set(field, value) {
      draft = { ...draft, [field]: value }
    },
    listVoices() {
      return listVoices(draft.provider)
    },
    previewSentence() {
      return FRIEND_TTS_PREVIEW_SENTENCE
    },
    async preview() {
      await options.onPreview?.(draft, FRIEND_TTS_PREVIEW_SENTENCE)
    },
    async commit() {
      const next = { ...draft }
      if (options.scope !== undefined) {
        await options.scope.set(TTS_PROVIDER_FIELD, next.provider)
        await options.scope.set(TTS_VOICE_FIELD, next.voice)
        await options.scope.set(TTS_RATE_FIELD, next.rate)
        await options.scope.set(TTS_PITCH_FIELD, next.pitch)
        await options.scope.set(TTS_AUTO_SPEAK_FIELD, next.autoSpeak)
        await options.scope.set(TTS_STRIP_STAGE_FIELD, next.stripStageDirections)
        await options.scope.set(TTS_VOLUME_FIELD, next.volume)
        await options.scope.set(TTS_MUTED_FIELD, next.muted)
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

function draftsEqual(left: TtsSettingsDraft, right: TtsSettingsDraft): boolean {
  return left.provider === right.provider
    && left.voice === right.voice
    && left.rate === right.rate
    && left.pitch === right.pitch
    && left.autoSpeak === right.autoSpeak
    && left.stripStageDirections === right.stripStageDirections
    && left.volume === right.volume
    && left.muted === right.muted
}
