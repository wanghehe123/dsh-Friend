/**
 * Client apply without importing React. The real `client.ts` supplies
 * render functions that call `createElement`; unit tests pass stubs.
 */
import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared/universal'

import { readCoreSettings } from './core-settings.ts'
import {
  FRIEND_SETTINGS_GENERAL_ITEM_ID,
  FRIEND_SETTINGS_GENERAL_ITEM_SLOT,
  FRIEND_SETTINGS_SECTION_ID,
  FRIEND_SETTINGS_SECTION_ORDER,
  FRIEND_SETTINGS_SECTION_SLOT,
} from './paths.ts'
import type { OverlayWriters } from './client-ui/ConfigOverlay.ts'
import { projectDocuments, type FriendClientSettingsSnapshot } from './project.ts'
import { defaultProjectAsr, defaultProjectTts } from './sanitize.ts'
import { installMuteBridge, resolvePlaybackKnobs } from './mute-bridge.ts'
import {
  createOverlayController,
  FRIEND_OPEN_SETTINGS_EVENT,
  type OverlayController,
} from './sections.ts'

export type FriendSettingsScope<T> = {
  getSnapshot(): { value: T | undefined }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
}

export type FriendSettingsScopeBinder = {
  bind<T>(spec: {
    namespace: string
    decode?: (section: unknown) => T | undefined
  }): FriendSettingsScope<T>
}

export type FriendSettingsSlots = {
  register(
    options: {
      name: string
      id: string
      order?: number
      label?: string | (() => string)
    },
    component: (props: { close?: () => void }) => unknown,
  ): () => void
}

export type FriendSettingsDocumentLike = {
  getElementById(id: string): { id: string } | null
  createElement(tag: string): { id: string; textContent: string }
  head: { appendChild(node: unknown): void }
  defaultView?: {
    location: { hash: string }
    addEventListener(type: string, listener: () => void): void
    removeEventListener(type: string, listener: () => void): void
  }
}

export type FriendSettingsClientSeams = {
  document?: FriendSettingsDocumentLike
  location?: { hash: string }
}

export type FriendSettingsClientContext = {
  effect?(execute: () => () => void, label?: string): void
  slots?: FriendSettingsSlots
  settingsScope?: FriendSettingsScopeBinder
}

export type SettingsClientRenderers = {
  ensureStyles?: (documentLike: FriendSettingsDocumentLike) => void
  renderSection: (input: {
    close?: () => void
    overlay: OverlayController
    snapshot: FriendClientSettingsSnapshot
    coreScope?: FriendSettingsScope<unknown>
    personaScope?: FriendSettingsScope<unknown>
    ttsScope?: FriendSettingsScope<unknown>
    writers?: OverlayWriters
    onOpenCenter: () => void
  }) => unknown
  renderGeneralItem: (input: {
    snapshot: FriendClientSettingsSnapshot
    onOpenCenter: () => void
  }) => unknown
  mountOverlay?: (input: {
    overlay: OverlayController
    snapshot: FriendClientSettingsSnapshot
    writers?: OverlayWriters
    onClose: () => void
  }) => () => void
}

export type FriendSettingsClientHandle = {
  overlay: OverlayController
  dispose: () => void
}

export function startSettingsClient(
  ctx: FriendSettingsClientContext,
  renderers: SettingsClientRenderers,
  options: FriendSettingsClientSeams = {},
): FriendSettingsClientHandle {
  const settingsScope = ctx.settingsScope
  const slots = ctx.slots
  const documentLike = options.document ?? defaultDocument()
  if (documentLike !== undefined) {
    renderers.ensureStyles?.(documentLike)
  }

  const location = createLocation(options.location, documentLike)
  const overlay = createOverlayController(location)
  overlay.syncFromHash()

  const coreScope = settingsScope?.bind({
    namespace: FRIEND_SETTINGS_NAMESPACES.core,
    decode: (section) => readCoreSettings(section),
  })
  const personaScope = settingsScope?.bind({
    namespace: FRIEND_SETTINGS_NAMESPACES.persona,
    decode: (section) => section,
  })
  const ttsScope = settingsScope?.bind({
    namespace: FRIEND_SETTINGS_NAMESPACES.tts,
    decode: (section) => defaultProjectTts(section),
  })
  const asrScope = settingsScope?.bind({
    namespace: FRIEND_SETTINGS_NAMESPACES.asr,
    decode: (section) => defaultProjectAsr(section),
  })
  const memoryScope = settingsScope?.bind({
    namespace: FRIEND_SETTINGS_NAMESPACES.memory,
    decode: (section) => section,
  })
  const growthScope = settingsScope?.bind({
    namespace: FRIEND_SETTINGS_NAMESPACES.growth,
    decode: (section) => section,
  })
  const stageScope = settingsScope?.bind({
    namespace: FRIEND_SETTINGS_NAMESPACES.stage,
    decode: (section) => section,
  })
  const reactionsScope = settingsScope?.bind({
    namespace: FRIEND_SETTINGS_NAMESPACES.reactions,
    decode: (section) => section,
  })

  const readSnapshot = (): FriendClientSettingsSnapshot => projectDocuments({
    [FRIEND_SETTINGS_NAMESPACES.core]: coreScope?.getSnapshot().value,
    [FRIEND_SETTINGS_NAMESPACES.persona]: personaScope?.getSnapshot().value,
    [FRIEND_SETTINGS_NAMESPACES.tts]: ttsScope?.getSnapshot().value,
    [FRIEND_SETTINGS_NAMESPACES.asr]: asrScope?.getSnapshot().value,
    [FRIEND_SETTINGS_NAMESPACES.memory]: memoryScope?.getSnapshot().value,
    [FRIEND_SETTINGS_NAMESPACES.growth]: growthScope?.getSnapshot().value,
    [FRIEND_SETTINGS_NAMESPACES.stage]: stageScope?.getSnapshot().value,
    [FRIEND_SETTINGS_NAMESPACES.reactions]: reactionsScope?.getSnapshot().value,
  })

  const writers: OverlayWriters = {
    ...(coreScope !== undefined ? { core: coreScope } : {}),
    ...(personaScope !== undefined ? { persona: personaScope } : {}),
    ...(ttsScope !== undefined ? { tts: ttsScope } : {}),
    ...(asrScope !== undefined ? { asr: asrScope } : {}),
    ...(memoryScope !== undefined ? { memory: memoryScope } : {}),
    ...(growthScope !== undefined ? { growth: growthScope } : {}),
    ...(stageScope !== undefined ? { stage: stageScope } : {}),
    ...(reactionsScope !== undefined ? { reactions: reactionsScope } : {}),
    ...(personaScope !== undefined || memoryScope !== undefined || growthScope !== undefined
      ? {
          model: {
            setChat: (value) => personaScope?.set('chatModel', value) ?? Promise.resolve(),
            setSummarize: (value) => memoryScope?.set('summarizeModel', value) ?? Promise.resolve(),
            setGrowth: (value) => growthScope?.set('model', value) ?? Promise.resolve(),
          },
        }
      : {}),
  }

  let unmountOverlay: (() => void) | undefined
  const refreshOverlayHost = (): void => {
    const open = overlay.getState().open
    if (open) {
      if (unmountOverlay !== undefined) {
        return
      }
      unmountOverlay = renderers.mountOverlay?.({
        overlay,
        snapshot: readSnapshot(),
        writers,
        onClose: () => {
          overlay.close()
          refreshOverlayHost()
        },
      })
      return
    }
    unmountOverlay?.()
    unmountOverlay = undefined
  }

  const openCenter = (): void => {
    overlay.open()
    refreshOverlayHost()
  }

  const disposers: Array<() => void> = []
  disposers.push(installMuteBridge({
    writers: {
      ...(ttsScope !== undefined ? { tts: ttsScope } : {}),
      ...(coreScope !== undefined ? { core: coreScope } : {}),
      ...(stageScope !== undefined ? { stage: stageScope } : {}),
    },
    readMuted: () => resolvePlaybackKnobs({
      tts: ttsScope?.getSnapshot().value,
      core: coreScope?.getSnapshot().value,
      stage: stageScope?.getSnapshot().value,
    }).muted,
    ...(ttsScope !== undefined
      ? {
          readTts: () => ttsScope.getSnapshot().value,
          subscribeTts: (listener) => ttsScope.subscribe(listener),
        }
      : {}),
  }))

  if (slots !== undefined) {
    disposers.push(slots.register({
      name: FRIEND_SETTINGS_SECTION_SLOT,
      id: FRIEND_SETTINGS_SECTION_ID,
      order: FRIEND_SETTINGS_SECTION_ORDER,
      label: 'dsh-Friend',
    }, (props) => renderers.renderSection({
      ...(props.close !== undefined ? { close: props.close } : {}),
      overlay,
      snapshot: readSnapshot(),
      ...(coreScope !== undefined ? { coreScope } : {}),
      ...(personaScope !== undefined ? { personaScope } : {}),
      ...(ttsScope !== undefined ? { ttsScope } : {}),
      writers,
      onOpenCenter: openCenter,
    })))
    disposers.push(slots.register({
      name: FRIEND_SETTINGS_GENERAL_ITEM_SLOT,
      id: FRIEND_SETTINGS_GENERAL_ITEM_ID,
      order: FRIEND_SETTINGS_SECTION_ORDER,
    }, () => renderers.renderGeneralItem({
      snapshot: readSnapshot(),
      onOpenCenter: openCenter,
    })))
  }

  const onHash = (): void => {
    overlay.syncFromHash()
    refreshOverlayHost()
  }
  const onOpenSettings = (): void => {
    overlay.open()
    refreshOverlayHost()
  }
  const view = documentLike?.defaultView
  view?.addEventListener('hashchange', onHash)
  view?.addEventListener(FRIEND_OPEN_SETTINGS_EVENT, onOpenSettings)
  const globalView = globalThis as {
    addEventListener?: (type: string, listener: () => void) => void
    removeEventListener?: (type: string, listener: () => void) => void
  }
  if (view === undefined) {
    globalView.addEventListener?.(FRIEND_OPEN_SETTINGS_EVENT, onOpenSettings)
    globalView.addEventListener?.('hashchange', onHash)
  }
  if (view !== undefined) {
    disposers.push(() => {
      view.removeEventListener('hashchange', onHash)
      view.removeEventListener(FRIEND_OPEN_SETTINGS_EVENT, onOpenSettings)
    })
  } else {
    disposers.push(() => {
      globalView.removeEventListener?.(FRIEND_OPEN_SETTINGS_EVENT, onOpenSettings)
      globalView.removeEventListener?.('hashchange', onHash)
    })
  }
  disposers.push(() => {
    unmountOverlay?.()
    unmountOverlay = undefined
  })
  if (overlay.getState().open) {
    refreshOverlayHost()
  }

  return {
    overlay,
    dispose() {
      for (const closer of disposers.splice(0).reverse()) closer()
    },
  }
}

function createLocation(
  explicit: FriendSettingsClientSeams['location'],
  documentLike: FriendSettingsDocumentLike | undefined,
): { getHash(): string; setHash(hash: string): void } {
  const location = explicit ?? documentLike?.defaultView?.location
  let memory = location?.hash ?? ''
  return {
    getHash() {
      return location?.hash ?? memory
    },
    setHash(hash) {
      memory = hash
      if (location !== undefined) {
        location.hash = hash
      }
    },
  }
}

function defaultDocument(): FriendSettingsDocumentLike | undefined {
  return (globalThis as { document?: FriendSettingsDocumentLike }).document
}
