export const FRIEND_ASR_GLOBAL = '__DSH_FRIEND_ASR__' as const
export const FRIEND_ASR_FACTORY_GLOBAL = '__DSH_FRIEND_ASR_FACTORY__' as const
export const FRIEND_ASR_FACTORY_READY_EVENT = 'dsh-friend:asr-factory-ready' as const
export const FRIEND_SHELL_TALK_EVENT = 'dsh-friend:shell-talk' as const
export const FRIEND_VOICE_BUTTON_ID = 'friend-voice' as const

export const PET_STAGE_CHAT_PATH = '/friend/stage/chat' as const

export type PetAsrSession = {
  dispatch(event: { type: 'hotkey-down' } | { type: 'hotkey-up' }): unknown
}

export type PetAsrHandle = {
  session: PetAsrSession
  dispose(): void
}

export type PetAsrFactory = (ctx: {
  window: PetAsrWindow
  document: PetAsrDocument
  onSend?: (text: string) => void
}) => PetAsrHandle

export type PetAsrDocument = {
  getElementById(id: string): PetAsrVoiceButton | null
}

export type PetAsrVoiceButton = {
  hidden: boolean | string
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
}

export type PetAsrWindow = {
  [FRIEND_ASR_GLOBAL]?: PetAsrHandle
  [FRIEND_ASR_FACTORY_GLOBAL]?: PetAsrFactory
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
  dispatchEvent(event: Event): boolean
}

export type MountPetAsrOptions = Readonly<{
  window: PetAsrWindow
  document: PetAsrDocument
  factory?: PetAsrFactory
  onSend?: (text: string) => void
}>

export type MountedPetAsr = {
  handle: PetAsrHandle | undefined
  dispose(): void
}

type ShellTalkDetail = {
  phase?: string
  mode?: string
}

export function postPetStageChat(
  text: string,
  fetchImpl: typeof fetch = fetch,
): void {
  void fetchImpl(PET_STAGE_CHAT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

/**
 * Adopt an ASR client on the standalone pet page.
 *
 * The pet IIFE cannot load `@wishp3/dsh-friend-asr/client` (ModuleLoader
 * payload). Production `src/pet.ts` supplies `startAsrClient` via
 * `options.factory` (naked ESM, always-bundled, with a snapshot settingsScope).
 *
 * `__DSH_FRIEND_ASR_FACTORY__` + `dsh-friend:asr-factory-ready` stay as an
 * optional late-bind override for tests / a future shell. Nothing in
 * production sets or dispatches them — do not add a setter.
 */
export function mountPetAsrClient(options: MountPetAsrOptions): MountedPetAsr {
  const win = options.window
  const voice = options.document.getElementById(FRIEND_VOICE_BUTTON_ID)
  let handle: PetAsrHandle | undefined
  let disposed = false

  const onShellTalk = (event: Event): void => {
    const phase = shellTalkPhase(event)
    if (phase === undefined || handle === undefined) return
    handle.session.dispatch({ type: phase === 'pressed' ? 'hotkey-down' : 'hotkey-up' })
  }

  const onVoiceDown = (): void => {
    handle?.session.dispatch({ type: 'hotkey-down' })
  }

  const onVoiceUp = (): void => {
    handle?.session.dispatch({ type: 'hotkey-up' })
  }

  const adopt = (next: PetAsrHandle): void => {
    handle?.dispose()
    handle = next
    win[FRIEND_ASR_GLOBAL] = next
    if (voice !== null) voice.hidden = false
  }

  const tryStart = (): void => {
    if (disposed || handle !== undefined) return
    const factory = options.factory ?? win[FRIEND_ASR_FACTORY_GLOBAL]
    if (factory === undefined) return
    adopt(factory({
      window: win,
      document: options.document,
      ...(options.onSend === undefined ? {} : { onSend: options.onSend }),
    }))
  }

  const onFactoryReady = (): void => {
    tryStart()
  }

  win.addEventListener(FRIEND_SHELL_TALK_EVENT, onShellTalk)
  win.addEventListener(FRIEND_ASR_FACTORY_READY_EVENT, onFactoryReady)
  voice?.addEventListener('pointerdown', onVoiceDown)
  voice?.addEventListener('pointerup', onVoiceUp)
  tryStart()

  return {
    get handle() {
      return handle
    },
    dispose() {
      disposed = true
      win.removeEventListener(FRIEND_SHELL_TALK_EVENT, onShellTalk)
      win.removeEventListener(FRIEND_ASR_FACTORY_READY_EVENT, onFactoryReady)
      voice?.removeEventListener('pointerdown', onVoiceDown)
      voice?.removeEventListener('pointerup', onVoiceUp)
      handle?.dispose()
      handle = undefined
      if (win[FRIEND_ASR_GLOBAL] !== undefined) delete win[FRIEND_ASR_GLOBAL]
    },
  }
}

function shellTalkPhase(event: Event): 'pressed' | 'released' | undefined {
  if (!('detail' in event)) return undefined
  const detail = (event as CustomEvent<ShellTalkDetail>).detail
  if (detail?.phase === 'pressed' || detail?.phase === 'released') return detail.phase
  return undefined
}
