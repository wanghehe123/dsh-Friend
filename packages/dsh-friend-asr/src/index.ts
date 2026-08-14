import {
  FRIEND_SETTINGS_NAMESPACES,
  logPluginMount,
  registerFriendSettings,
  registerRoute,
  type FriendRouteContext,
} from '@wish233/dsh-friend-shared'

import { createAsrTranscribeProxy } from './proxy.ts'
import { createAsrTranscribeRoute } from './routes.ts'
import { readFriendAsrHostSettings } from './settings.ts'
import {
  createFriendAsrSettingsSchema,
  DEFAULT_ASR_SETTINGS_ENTRY,
} from './settings-schema.ts'

export const name = '@wish233/dsh-friend-asr'
/** Cordis forbids reading `ctx.webServer` / `ctx.settings` unless this plugin injects them. */
export const inject = ['webServer', 'settings'] as const

export {
  resolveAsrEngine,
  selectAsrEngine,
  type AsrEngine,
  type AsrEngineCapabilities,
  type AsrEngineChoice,
  type AsrEngineId,
  type AsrEnginePreference,
  type AsrErrorHandler,
  type AsrListenMode,
  type AsrTranscriptHandler,
  type AsrUnavailableCode,
} from './engine.ts'

export {
  WEBSPEECH_DEFAULT_LANG,
  WEBSPEECH_ENGINE_ID,
  createWebSpeechEngine,
  inspectWebSpeechCapabilities,
  isDesktopShellUserAgent,
  isNonChromiumSafari,
  type SpeechRecognitionConstructor,
  type SpeechRecognitionLike,
  type WebSpeechEngineOptions,
  type WebSpeechGlobals,
} from './engines/webspeech.ts'

export {
  ENDPOINT_ENGINE_ID,
  createEndpointEngine,
  inspectEndpointCapabilities,
  type EndpointEngineOptions,
  type EndpointGlobals,
} from './engines/endpoint.ts'

export {
  ASR_DEFAULT_MODE,
  ASR_DEFAULT_SILENCE_MS,
  createAsrModeMachine,
  reduceAsrMode,
  type AsrModeConfig,
  type AsrModeEffect,
  type AsrModeEvent,
  type AsrModeMachine,
  type AsrModeState,
  type AsrModeStep,
  type AsrPhase,
} from './modes.ts'

export {
  createAsrSession,
  type AsrSession,
  type AsrSessionHooks,
  type AsrSessionOptions,
} from './session.ts'

export {
  ASR_DEFAULT_HOTKEY,
  ASR_HOTKEY_FIELD,
  chordFromKeyEvent,
  chordsEqual,
  createAsrHotkeyController,
  evaluateAsrHotkey,
  formatAsrHotkey,
  isTextEntryTarget,
  matchAsrHotkey,
  normalizeAsrKey,
  parseAsrHotkey,
  type AsrHotkeyAccepted,
  type AsrHotkeyCategory,
  type AsrHotkeyController,
  type AsrHotkeyControllerOptions,
  type AsrHotkeyDecision,
  type AsrHotkeyRejected,
  type AsrHotkeyStore,
  type AsrHotkeyTarget,
  type AsrKeyChord,
  type AsrKeyEventLike,
} from './hotkey.ts'

export {
  ASR_AUTO_SEND_FIELD,
  ASR_BARGE_IN_FIELD,
  ASR_ENGINE_FIELD,
  ASR_LANGUAGE_FIELD,
  ASR_MODE_FIELD,
  ASR_OPENAI_API_KEY_FIELD,
  ASR_OPENAI_BASE_URL_FIELD,
  ASR_OPENAI_MODEL_FIELD,
  ASR_SETTINGS_DEFAULTS,
  ASR_SETTINGS_NAMESPACE,
  ASR_SILENCE_MS_FIELD,
  FRIEND_ASR_SECRET_FIELDS,
  bindAsrSettings,
  createScopeHotkeyStore,
  readFriendAsrHostSettings,
  readFriendAsrSettings,
  sanitizeAsrSettingsForClient,
  type AsrSettingsBinder,
  type AsrSettingsScope,
  type FriendAsrHostSettings,
  type FriendAsrSettings,
} from './settings.ts'

export { FRIEND_ASR_TRANSCRIBE_PATH } from './paths.ts'
export { FRIEND_STAGE_CHAT_PATH, postFriendStageChat } from './send.ts'
export {
  createSnapshotAsrSettingsBinder,
  FRIEND_ASR_SETTINGS_NAMESPACE,
  FRIEND_SETTINGS_PATCH_PATH,
  FRIEND_SETTINGS_SNAPSHOT_PATH,
} from './settings-snapshot.ts'
export { ASR_TRANSCRIBE_TIMEOUT_MS, createAsrTranscribeProxy } from './proxy.ts'
export { createAsrRoutes, createAsrTranscribeRoute } from './routes.ts'
export { FRIEND_TTS_STOP_ALL_GLOBAL, invokeFriendTtsStopAll } from './barge-in.ts'
export {
  createAsrSettingsForm,
  renderAsrCapabilityCards,
  type AsrCapabilityCard,
  type AsrSettingsForm,
} from './settings-form.ts'

export type FriendAsrApplyContext = {
  effect?: FriendRouteContext['effect']
  settings?: {
    get(namespace: string): unknown
  }
  webServer?: FriendRouteContext['webServer']
}

export function apply(ctx: FriendAsrApplyContext = {}): void {
  logPluginMount(name)
  registerFriendSettings(
    ctx,
    FRIEND_SETTINGS_NAMESPACES.asr,
    createFriendAsrSettingsSchema(),
    DEFAULT_ASR_SETTINGS_ENTRY,
  )
  const routeCtx = asRouteContext(ctx)
  if (routeCtx === undefined) {
    return
  }
  const proxy = createAsrTranscribeProxy({
    getCredentials: () => {
      const settings = ctx.settings
      if (settings === undefined) return undefined
      try {
        const host = readFriendAsrHostSettings(settings.get(FRIEND_SETTINGS_NAMESPACES.asr))
        return {
          ...(host.openaiApiKey !== undefined ? { apiKey: host.openaiApiKey } : {}),
          ...(host.openaiBaseURL !== undefined ? { baseURL: host.openaiBaseURL } : {}),
          ...(host.openaiModel !== undefined ? { model: host.openaiModel } : {}),
        }
      } catch {
        return undefined
      }
    },
  })
  registerRoute(routeCtx, createAsrTranscribeRoute({
    proxy,
    getLanguage: () => {
      const settings = ctx.settings
      if (settings === undefined) return undefined
      try {
        return readFriendAsrHostSettings(settings.get(FRIEND_SETTINGS_NAMESPACES.asr)).language
      } catch {
        return undefined
      }
    },
  }))
}

function asRouteContext(ctx: FriendAsrApplyContext): FriendRouteContext | undefined {
  if (ctx.webServer === undefined || ctx.effect === undefined) {
    return undefined
  }
  return { webServer: ctx.webServer, effect: ctx.effect }
}
