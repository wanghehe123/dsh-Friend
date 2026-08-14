import {
  FRIEND_ASR_CLIENT_GLOBAL,
  startAsrClient,
  type AsrClientHandle,
  type FriendAsrClientContext,
} from './browser.ts'
import { postFriendStageChat } from './send.ts'
import type { AsrSettingsBinder, AsrSettingsScope } from './settings.ts'
import { createSnapshotAsrSettingsBinder } from './settings-snapshot.ts'

export const name = '@wish233/dsh-friend-asr/client'
export const inject = ['settingsScope'] as const
export const ASR_CLIENT_SETTINGS_POLL_MS = 1_000

export type {
  AsrClientHandle,
  FriendAsrBrowserGlobals,
  FriendAsrClientContext,
  FriendAsrClientOptions,
} from './browser.ts'

export type FriendAsrClientApplyOptions = {
  onSend?: (text: string) => void
  fetch?: typeof fetch
}

type AsrClientGlobalHolder = {
  [FRIEND_ASR_CLIENT_GLOBAL]?: AsrClientHandle
}

function asrClientGlobals(): AsrClientGlobalHolder {
  return globalThis as typeof globalThis & AsrClientGlobalHolder
}

function installAsrClientGlobal(handle: AsrClientHandle): () => void {
  const holder = asrClientGlobals()
  holder[FRIEND_ASR_CLIENT_GLOBAL] = handle
  return () => {
    if (holder[FRIEND_ASR_CLIENT_GLOBAL] === handle) {
      delete holder[FRIEND_ASR_CLIENT_GLOBAL]
    }
  }
}

function withSnapshotFallback(
  primary: AsrSettingsBinder,
  fallback: AsrSettingsBinder,
): AsrSettingsBinder {
  return {
    bind(spec) {
      const primaryScope = primary.bind(spec)
      let fallbackScope: AsrSettingsScope | undefined
      let unsubscribePrimary: (() => void) | undefined
      let unsubscribeFallback: (() => void) | undefined
      const listeners = new Set<() => void>()

      const notify = (): void => {
        for (const listener of listeners) listener()
      }
      const releaseFallback = (): void => {
        unsubscribeFallback?.()
        unsubscribeFallback = undefined
        // Snapshot scopes close when their last subscriber leaves. Discard the
        // closed instance so a later primary outage gets a fresh GET + poller.
        fallbackScope = undefined
      }
      const ensureFallback = (): AsrSettingsScope => {
        fallbackScope ??= fallback.bind(spec)
        if (listeners.size > 0 && unsubscribeFallback === undefined) {
          unsubscribeFallback = fallbackScope.subscribe(notify)
        }
        return fallbackScope
      }
      const primaryReady = (): boolean => primaryScope.getSnapshot().status === 'ready'
      const active = (): AsrSettingsScope => {
        if (primaryReady()) {
          releaseFallback()
          return primaryScope
        }
        return ensureFallback()
      }
      const onPrimaryChange = (): void => {
        if (primaryReady()) {
          releaseFallback()
          notify()
          return
        }
        // Keep consumers on their last applied values until the new snapshot
        // scope completes its first GET. Its notification then hydrates them.
        ensureFallback()
      }

      return {
        getSnapshot: () => active().getSnapshot(),
        subscribe(listener) {
          listeners.add(listener)
          unsubscribePrimary ??= primaryScope.subscribe(onPrimaryChange)
          if (!primaryReady()) {
            ensureFallback()
          }
          return () => {
            listeners.delete(listener)
            if (listeners.size !== 0) return
            unsubscribePrimary?.()
            unsubscribePrimary = undefined
            releaseFallback()
          }
        },
        set(field, value) {
          return active().set(field, value)
        },
        unset(field) {
          return active().unset(field)
        },
      }
    },
  }
}

export function apply(
  ctx: FriendAsrClientContext = {},
  options: FriendAsrClientApplyOptions = {},
): AsrClientHandle {
  // Only forward the declared dsh service. window/document/engine stay on
  // the startAsrClient options bag / globalThis — never on ctx.
  // onSend is not a service: production default POSTs /friend/stage/chat.
  const fetchImpl = options.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch
  const onSend = options.onSend ?? ((text: string) => {
    if (fetchImpl === undefined) {
      return
    }
    postFriendStageChat(text, fetchImpl)
  })
  const snapshotSettings = createSnapshotAsrSettingsBinder({
    ...(fetchImpl !== undefined ? { fetch: fetchImpl } : {}),
    pollMs: ASR_CLIENT_SETTINGS_POLL_MS,
  })
  // Keep the official dsh scope when it is ready. In rc.6 custom namespaces
  // can instead resolve to `unavailable`; fall back to the same sanitized host
  // snapshot used by the pet iframe so a saved Alt+X does not stay Alt+S here.
  const injectedSettings = ctx.settingsScope
  const settingsScope = injectedSettings === undefined
    ? snapshotSettings
    : withSnapshotFallback(injectedSettings, snapshotSettings)
  const handle = startAsrClient({
    settingsScope,
    onSend,
  })
  const onToggleListen = (): void => {
    const state = handle.session.getState()
    if (state.mode === 'auto') {
      if (state.phase === 'idle') {
        handle.session.dispatch({ type: 'boot' })
      }
      handle.engine.start('auto')
      return
    }
    handle.session.dispatch({ type: 'hotkey-down' })
  }
  const onYield = (): void => {
    handle.session.dispatch({ type: 'reset' })
  }
  const onResume = (): void => {
    if (handle.session.getState().mode === 'auto') {
      handle.session.dispatch({ type: 'boot' })
    }
  }
  const host = globalThis as {
    addEventListener?: (type: string, listener: () => void) => void
    removeEventListener?: (type: string, listener: () => void) => void
  }
  host.addEventListener?.('dsh-friend:toggle-listen', onToggleListen)
  host.addEventListener?.('dsh-friend:asr-yield', onYield)
  host.addEventListener?.('dsh-friend:asr-resume', onResume)
  const uninstall = installAsrClientGlobal(handle)
  const originalDispose = handle.dispose
  handle.dispose = () => {
    host.removeEventListener?.('dsh-friend:toggle-listen', onToggleListen)
    host.removeEventListener?.('dsh-friend:asr-yield', onYield)
    host.removeEventListener?.('dsh-friend:asr-resume', onResume)
    uninstall()
    originalDispose()
  }
  if (ctx.effect !== undefined) {
    ctx.effect(() => () => handle.dispose(), 'dsh-friend-asr:client')
    return handle
  }
  console.info(`[${name}] apply()`)
  return handle
}

export { startAsrClient, FRIEND_ASR_CLIENT_GLOBAL } from './browser.ts'
export { invokeFriendTtsStopAll, FRIEND_TTS_STOP_ALL_GLOBAL } from './barge-in.ts'
export { resolveAsrEngine, selectAsrEngine } from './engine.ts'
export { createEndpointEngine, inspectEndpointCapabilities, ENDPOINT_ENGINE_ID } from './engines/endpoint.ts'
export {
  FRIEND_STAGE_CHAT_DEDUPE_MS,
  FRIEND_STAGE_CHAT_PATH,
  postFriendStageChat,
  resetFriendStageChatDedupe,
} from './send.ts'
export {
  createAsrSettingsForm,
  renderAsrCapabilityCards,
  type AsrCapabilityCard,
  type AsrSettingsForm,
} from './settings-form.ts'
export {
  ASR_SETTINGS_NAMESPACE,
  bindAsrSettings,
  readFriendAsrSettings,
  sanitizeAsrSettingsForClient,
} from './settings.ts'
export {
  createSnapshotAsrSettingsBinder,
  FRIEND_ASR_SETTINGS_NAMESPACE,
  FRIEND_SETTINGS_PATCH_PATH,
  FRIEND_SETTINGS_SNAPSHOT_PATH,
} from './settings-snapshot.ts'
