import {
  FRIEND_ASR_CLIENT_GLOBAL,
  startAsrClient,
  type AsrClientHandle,
  type FriendAsrClientContext,
} from './browser.ts'
import { postFriendStageChat } from './send.ts'

export const name = '@wish233/dsh-friend-asr/client'
export const inject = ['settingsScope'] as const

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
  const handle = startAsrClient({
    ...(ctx.settingsScope !== undefined ? { settingsScope: ctx.settingsScope } : {}),
    onSend,
  })
  const uninstall = installAsrClientGlobal(handle)
  const originalDispose = handle.dispose
  handle.dispose = () => {
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
export { FRIEND_STAGE_CHAT_PATH, postFriendStageChat } from './send.ts'
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
