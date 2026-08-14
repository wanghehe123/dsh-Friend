/**
 * Staged parent-card form (W-M8-1). Draft edits stay local until commit.
 * Child controls disable when the master switch is off.
 */
import {
  childControlsEnabled,
  CORE_SETTING_FIELDS,
  DEFAULT_CHARACTER_SLUG,
  PERSONA_CURRENT_SLUG_FIELD,
  readCoreSettings,
  readCurrentSlug,
  type FriendCoreSettings,
  type FriendUiLanguage,
} from './core-settings.ts'
import { resolvePlaybackKnobs } from './mute-bridge.ts'

export type PluginCardDraft = FriendCoreSettings & {
  currentSlug: string
}

export type PluginCardCharacter = {
  slug: string
  name: string
}

export type SettingsFieldWriter = {
  set(field: string, value: unknown): Promise<void>
}

export type PluginCardForm = {
  getDraft(): PluginCardDraft
  getCommitted(): PluginCardDraft
  isDirty(): boolean
  set<K extends keyof PluginCardDraft>(field: K, value: PluginCardDraft[K]): void
  childControlsEnabled(): boolean
  characters(): readonly PluginCardCharacter[]
  commit(): Promise<void>
  discard(): void
}

export type CreatePluginCardFormOptions = {
  core?: unknown
  persona?: unknown
  tts?: unknown
  characters?: readonly PluginCardCharacter[]
  coreScope?: SettingsFieldWriter
  personaScope?: SettingsFieldWriter
  ttsScope?: SettingsFieldWriter
}

export function draftFromCardSources(
  core: unknown,
  persona: unknown,
  tts?: unknown,
): PluginCardDraft {
  const base = readCoreSettings(core)
  const playback = resolvePlaybackKnobs({ tts, core })
  return {
    ...base,
    volume: playback.volume,
    muted: playback.muted,
    currentSlug: readCurrentSlug(persona),
  }
}

export function createPluginCardForm(options: CreatePluginCardFormOptions = {}): PluginCardForm {
  const readCommitted = (): PluginCardDraft => draftFromCardSources(options.core, options.persona, options.tts)
  let committed = readCommitted()
  let draft = { ...committed }
  const characters = options.characters ?? [
    { slug: DEFAULT_CHARACTER_SLUG, name: DEFAULT_CHARACTER_SLUG },
  ]

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
    childControlsEnabled() {
      return childControlsEnabled(draft)
    },
    characters() {
      return characters
    },
    async commit() {
      const next = { ...draft }
      if (options.ttsScope !== undefined) {
        await options.ttsScope.set(CORE_SETTING_FIELDS.volume, next.volume)
        await options.ttsScope.set(CORE_SETTING_FIELDS.muted, next.muted)
      }
      if (options.coreScope !== undefined) {
        await options.coreScope.set(CORE_SETTING_FIELDS.enabled, next.enabled)
        await options.coreScope.set(CORE_SETTING_FIELDS.floatEnabled, next.floatEnabled)
        await options.coreScope.set(CORE_SETTING_FIELDS.volume, next.volume)
        await options.coreScope.set(CORE_SETTING_FIELDS.muted, next.muted)
        await options.coreScope.set(CORE_SETTING_FIELDS.language, next.language)
      }
      if (options.personaScope !== undefined) {
        await options.personaScope.set(PERSONA_CURRENT_SLUG_FIELD, next.currentSlug)
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

export function languageOptions(): readonly FriendUiLanguage[] {
  return ['system', 'zh', 'en']
}

function draftsEqual(left: PluginCardDraft, right: PluginCardDraft): boolean {
  return left.enabled === right.enabled
    && left.floatEnabled === right.floatEnabled
    && left.volume === right.volume
    && left.muted === right.muted
    && left.language === right.language
    && left.currentSlug === right.currentSlug
}
