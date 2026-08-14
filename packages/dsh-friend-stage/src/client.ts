/**
 * DSH web-module entry. Pixi / Live2D stay out of this factory — the
 * renderer is an iframe of `/friend/pet` (Core script + pet IIFE).
 */
import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared/universal'

import { bindCoreSettings, bindOverlaySettings, mountFriendStageOverlay } from './overlay.ts'

export const name = '@wish233/dsh-friend-stage/client'
export const inject = ['settingsScope'] as const

export type FriendStageClientContext = {
  effect?(execute: () => () => void, label?: string): void
  settingsScope?: {
    bind(spec: { namespace: typeof FRIEND_SETTINGS_NAMESPACES.stage | typeof FRIEND_SETTINGS_NAMESPACES.core }): {
      getSnapshot(): { value: unknown }
      subscribe(listener: () => void): () => void
      set(field: string, value: unknown): Promise<void>
    }
  }
}

export function apply(ctx: FriendStageClientContext = {}): void {
  const documentLike = (globalThis as { document?: Parameters<typeof mountFriendStageOverlay>[0]['document'] }).document
  const windowLike = (globalThis as { window?: Parameters<typeof mountFriendStageOverlay>[0]['window'] }).window
  if (documentLike === undefined || windowLike === undefined) {
    return
  }
  const settings = ctx.settingsScope === undefined ? undefined : bindOverlaySettings(ctx.settingsScope)
  const coreSettings = ctx.settingsScope === undefined ? undefined : bindCoreSettings(ctx.settingsScope)
  const handle = mountFriendStageOverlay({
    document: documentLike,
    window: windowLike,
    ...(settings === undefined ? {} : { settings }),
    ...(coreSettings === undefined ? {} : { coreSettings }),
  })
  if (ctx.effect !== undefined) {
    ctx.effect(() => () => handle.dispose(), 'dsh-friend-stage:client')
    return
  }
  const globalWindow = globalThis as { __DSH_FRIEND_STAGE__?: { show(): void; hide(): void } }
  globalWindow.__DSH_FRIEND_STAGE__ = { show: () => handle.show(), hide: () => handle.hide() }
}

export { FRIEND_SETTINGS_NAMESPACES }
