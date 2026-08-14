/**
 * Client half. Must stay free of `node:` and `@wishp3/dsh-friend-shared`
 * (host). Namespace constants come from `/universal`.
 *
 * React is a dsh web platform seed (`shared/web-platform.ts`). Do not
 * statically import it here — the factory must materialize without
 * touching the loader table. Slot render callbacks call `friendReact()`.
 */
import { FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared/universal'

import {
  startSettingsClient,
  type FriendSettingsClientContext,
  type FriendSettingsClientHandle,
} from './client-register.ts'
import { ConfigOverlay, type OverlayWriters } from './client-ui/ConfigOverlay.ts'
import { friendReact } from './client-ui/friend-react.ts'
import { GeneralItem } from './client-ui/GeneralItem.ts'
import { PluginCard } from './client-ui/PluginCard.ts'
import { ensureFriendSettingsStyles } from './client-ui/styles.ts'
import { createPluginCardForm } from './plugin-card.ts'
import { parseConfigHash, type OverlayController } from './sections.ts'
import type { FriendClientSettingsSnapshot } from './project.ts'

export { inject, name } from './client-meta.ts'

export function apply(ctx: FriendSettingsClientContext = {}): FriendSettingsClientHandle {
  const handle = startSettingsClient(ctx, {
    ensureStyles: ensureFriendSettingsStyles,
    renderSection(input) {
      const { createElement } = friendReact()
      return createElement(
        'div',
        null,
        createElement(PluginCard, {
          ...(input.close !== undefined ? { close: input.close } : {}),
          core: input.coreScope?.getSnapshot().value,
          persona: input.personaScope?.getSnapshot().value,
          tts: input.ttsScope?.getSnapshot().value,
          ...(input.coreScope !== undefined ? { coreScope: input.coreScope } : {}),
          ...(input.personaScope !== undefined ? { personaScope: input.personaScope } : {}),
          ...(input.ttsScope !== undefined ? { ttsScope: input.ttsScope } : {}),
          onOpenCenter: input.onOpenCenter,
          collapsible: input.surface === 'plugin',
        }),
      )
    },
    renderGeneralItem(input) {
      const { createElement } = friendReact()
      return createElement(GeneralItem, {
        core: input.snapshot.core,
        onOpenCenter: input.onOpenCenter,
      })
    },
    mountOverlay(input) {
      return mountConfigOverlayHost(input)
    },
  })
  if (ctx.effect !== undefined) {
    ctx.effect(() => () => handle.dispose(), 'dsh-friend-settings:client')
  } else {
    console.info(`[${name}] apply()`)
  }
  return handle
}

export {
  createPluginCardForm,
  FRIEND_SETTINGS_NAMESPACES,
  parseConfigHash,
  startSettingsClient,
}

export type {
  FriendSettingsClientContext,
  FriendSettingsClientHandle,
  FriendSettingsClientSeams,
  FriendSettingsDocumentLike,
} from './client-register.ts'

const OVERLAY_HOST_ID = 'dsh-friend-config-host'

type OverlayHostNode = {
  id: string
  remove(): void
}

type OverlayRoot = {
  render(node: unknown): void
  unmount(): void
}

function mountConfigOverlayHost(input: {
  overlay: OverlayController
  snapshot: FriendClientSettingsSnapshot
  writers?: OverlayWriters
  onClose: () => void
}): () => void {
  const doc = (globalThis as { document?: {
    getElementById(id: string): OverlayHostNode | null
    createElement(tag: string): OverlayHostNode
    body?: { appendChild(node: OverlayHostNode): void }
  } }).document
  if (doc === undefined) {
    return () => {}
  }
  let createRoot: ((container: OverlayHostNode) => OverlayRoot) | undefined
  try {
    const loaded = require('react-dom/client') as { createRoot?: (container: OverlayHostNode) => OverlayRoot }
    createRoot = typeof loaded.createRoot === 'function' ? loaded.createRoot : undefined
  } catch {
    return () => {}
  }
  if (createRoot === undefined) {
    return () => {}
  }
  const { createElement } = friendReact()
  const existing = doc.getElementById(OVERLAY_HOST_ID)
  existing?.remove()
  const host = doc.createElement('div')
  host.id = OVERLAY_HOST_ID
  doc.body?.appendChild(host)
  const root = createRoot(host)
  root.render(createElement(ConfigOverlay, {
    overlay: input.overlay,
    snapshot: input.snapshot,
    ...(input.writers !== undefined ? { writers: input.writers } : {}),
    onClose: input.onClose,
  }))
  return () => {
    root.unmount()
    if (doc.getElementById(OVERLAY_HOST_ID) === host) {
      host.remove()
    }
  }
}
