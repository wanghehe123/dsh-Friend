/**
 * Lean browser entry for the standalone pet page (no ModuleLoader, no `node:`).
 *
 * Import from `@wish233/dsh-friend-asr/browser`. Built as ordinary ESM
 * (`lib/browser.js`) — safe to always-bundle into `pet.iife.js`.
 *
 * Allowed shared import: `@wish233/dsh-friend-shared/universal` only.
 *
 * @see `./client.ts` — dsh web ModuleLoader payload (`./client`)
 * @see `./index.ts` — Node host (proxy, routes, `node:`)
 */
import { invokeFriendTtsStopAll } from './barge-in.ts'
import type { AsrEngine } from './engine.ts'
import { resolveAsrEngine } from './engine.ts'
import {
  createEndpointEngine,
  type EndpointGlobals,
} from './engines/endpoint.ts'
import { createWebSpeechEngine, type WebSpeechGlobals } from './engines/webspeech.ts'
import {
  createAsrHotkeyController,
  type AsrHotkeyController,
  type AsrHotkeyTarget,
} from './hotkey.ts'
import { createAsrSession, type AsrSession } from './session.ts'
import {
  bindAsrSettings,
  createScopeHotkeyStore,
  readFriendAsrSettings,
  type AsrSettingsBinder,
  type AsrSettingsScope,
} from './settings.ts'

export type FriendAsrBrowserGlobals = WebSpeechGlobals & EndpointGlobals

export type FriendAsrClientContext = {
  effect?(execute: () => () => void, label?: string): void
  settingsScope?: AsrSettingsBinder
}

export type FriendAsrClientOptions = FriendAsrClientContext & {
  settingsScope?: AsrSettingsBinder
  document?: AsrHotkeyTarget
  window?: FriendAsrBrowserGlobals
  /** Override MediaRecorder / getUserMedia lookup (tests and odd hosts). */
  endpointGlobals?: EndpointGlobals
  /** Override `fetch` used by the endpoint engine. */
  fetch?: typeof fetch
  /** Pinned engine. When set, settings `engine` changes do not rebind. */
  engine?: AsrEngine
  /** Catalog for `resolveAsrEngine`. Defaults to webspeech + endpoint. */
  engines?: readonly AsrEngine[]
  onSend?: (text: string) => void
  onBargeIn?: () => void
  getLanguage?: () => string
}

export type AsrClientHandle = {
  session: AsrSession
  hotkey: AsrHotkeyController
  engine: AsrEngine
  /** Present when `settingsScope` was passed — the live bound namespace. */
  settings?: AsrSettingsScope
  getLanguage(): string
  submitFinal(text: string): void
  dispose: () => void
}

/** Same well-known name the pet page uses (`stage/src/pet-asr.ts`). */
export const FRIEND_ASR_CLIENT_GLOBAL = '__DSH_FRIEND_ASR__' as const

function defaultDocument(): AsrHotkeyTarget | undefined {
  const fromGlobal = (globalThis as { document?: AsrHotkeyTarget }).document
  return fromGlobal
}

function isHotkeyTarget(value: unknown): value is AsrHotkeyTarget {
  if (value === undefined || value === null || typeof value !== 'object') {
    return false
  }
  const candidate = value as { addEventListener?: unknown; removeEventListener?: unknown }
  return typeof candidate.addEventListener === 'function'
    && typeof candidate.removeEventListener === 'function'
}

function resolveEndpointGlobals(options: FriendAsrClientOptions): EndpointGlobals | undefined {
  if (options.endpointGlobals !== undefined) {
    return options.endpointGlobals
  }
  if (options.window !== undefined) {
    return options.window
  }
  return undefined
}

function defaultBargeIn(): void {
  invokeFriendTtsStopAll()
}

export function startAsrClient(options: FriendAsrClientOptions = {}): AsrClientHandle {
  const settingsScope = options.settingsScope
  const scope = settingsScope !== undefined ? bindAsrSettings(settingsScope) : undefined
  const settings = readFriendAsrSettings(scope?.getSnapshot().value)
  const pinnedEngine = options.engine

  const liveLanguage = (): string => {
    const fromOptions = options.getLanguage?.()
    if (fromOptions !== undefined && fromOptions.length > 0) {
      return fromOptions
    }
    if (scope !== undefined) {
      return readFriendAsrSettings(scope.getSnapshot().value).language
    }
    return settings.language
  }

  const webspeech = createWebSpeechEngine({
    ...(options.window !== undefined ? { globals: options.window } : {}),
    getLang: liveLanguage,
  })
  const endpointGlobals = resolveEndpointGlobals(options)
  const endpoint = createEndpointEngine({
    ...(endpointGlobals !== undefined ? { globals: endpointGlobals } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    getLang: liveLanguage,
  })
  const catalog = options.engines ?? [webspeech, endpoint]
  const pickEngine = (preference: typeof settings.engine): AsrEngine => {
    if (pinnedEngine !== undefined) {
      return pinnedEngine
    }
    return resolveAsrEngine(preference, catalog).engine ?? catalog[0] ?? webspeech
  }
  let currentEngine = pickEngine(settings.engine)

  const session = createAsrSession({
    engine: currentEngine,
    mode: settings.mode,
    bargeIn: settings.bargeIn,
    silenceMs: settings.silenceMs,
    autoSend: settings.autoSend,
    ...(options.onSend !== undefined ? { onSend: options.onSend } : {}),
    onBargeIn: options.onBargeIn ?? defaultBargeIn,
  })

  const target = isHotkeyTarget(options.document) ? options.document : defaultDocument()
  const hotkey = createAsrHotkeyController({
    ...(target !== undefined ? { target } : {}),
    ...(scope !== undefined ? { store: createScopeHotkeyStore(scope) } : {}),
    initial: settings.hotkey,
    onDown: () => {
      session.dispatch({ type: 'hotkey-down' })
    },
    onUp: () => {
      session.dispatch({ type: 'hotkey-up' })
    },
  })
  hotkey.attach()

  const unsubscribe = scope?.subscribe(() => {
    const live = readFriendAsrSettings(scope.getSnapshot().value)
    if (session.getState().mode !== live.mode) {
      session.setMode(live.mode)
    }
    session.setBargeIn(live.bargeIn)
    session.setSilenceMs(live.silenceMs)
    session.setAutoSend(live.autoSend)
    if (hotkey.getSpec() !== live.hotkey) {
      hotkey.setHotkey(live.hotkey)
    }
    if (pinnedEngine === undefined) {
      const next = pickEngine(live.engine)
      if (next !== currentEngine) {
        session.setEngine(next)
        currentEngine = session.getEngine()
      }
    }
  })

  const dispose = (): void => {
    unsubscribe?.()
    hotkey.dispose()
    session.dispose()
  }

  return {
    session,
    hotkey,
    get engine() {
      return currentEngine
    },
    ...(scope !== undefined ? { settings: scope } : {}),
    getLanguage: liveLanguage,
    submitFinal(text) {
      session.submitFinal(text)
    },
    dispose,
  }
}

export { invokeFriendTtsStopAll, FRIEND_TTS_STOP_ALL_GLOBAL } from './barge-in.ts'
export { FRIEND_STAGE_CHAT_PATH, postFriendStageChat } from './send.ts'
export {
  createSnapshotAsrSettingsBinder,
  FRIEND_ASR_SETTINGS_NAMESPACE,
  FRIEND_SETTINGS_PATCH_PATH,
  FRIEND_SETTINGS_SNAPSHOT_PATH,
} from './settings-snapshot.ts'
export { resolveAsrEngine, selectAsrEngine } from './engine.ts'
export type {
  AsrEngine,
  AsrEngineCapabilities,
  AsrEngineChoice,
  AsrEngineId,
  AsrEnginePreference,
  AsrListenMode,
} from './engine.ts'
export { createEndpointEngine, inspectEndpointCapabilities, ENDPOINT_ENGINE_ID } from './engines/endpoint.ts'
export type { EndpointGlobals } from './engines/endpoint.ts'
export {
  createWebSpeechEngine,
  inspectWebSpeechCapabilities,
  WEBSPEECH_ENGINE_ID,
} from './engines/webspeech.ts'
export type { WebSpeechGlobals } from './engines/webspeech.ts'
