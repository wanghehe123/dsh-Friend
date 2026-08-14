/**
 * Client half. Must stay free of `node:` and `@wishp3/dsh-friend-shared`
 * (host). Namespace constants come from `/universal`.
 */
import { FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared/universal'

import {
  applyPetPerformance,
  dispatchFriendReaction,
  FRIEND_REACTION_EVENT,
  snapshotFromReactionMessage,
  type FriendReactionTarget,
} from './dispatch.ts'
import { enqueueReactionTts } from './enqueue-tts.ts'

export const name = '@wishp3/dsh-friend-reactions/client'
export const inject: string[] = []

export const REACTIONS_SETTINGS_NAMESPACE = FRIEND_SETTINGS_NAMESPACES.reactions

export type ReactionClientEventSource = new (url: string) => {
  addEventListener(type: string, listener: (event: { data: string }) => void): void
  close(): void
}

export type ReactionClientContext = {
  effect?(execute: () => () => void, label?: string): void
}

export type ReactionClientOptions = {
  EventSource?: ReactionClientEventSource
  applyPerformance?: (snapshot: unknown) => void
  enqueueTts?: (text: string) => void
  target?: FriendReactionTarget
}

type ReactionSnapshotLike = {
  level?: unknown
  quip?: unknown
}

export function apply(
  ctx: ReactionClientContext = {},
  options: ReactionClientOptions = {},
): void {
  console.info(`[${name}] apply()`)
  const target = options.target ?? (globalThis as unknown as FriendReactionTarget)
  const present = (snapshot: unknown): void => {
    if (typeof options.applyPerformance === 'function') {
      options.applyPerformance(snapshot)
    } else {
      applyPetPerformance(snapshot, target)
    }
    dispatchFriendReaction(snapshot, target)
    speakVoiceQuip(snapshot, options.enqueueTts)
  }

  const onCustom = (event: Event): void => {
    if (!(event instanceof CustomEvent)) {
      return
    }
    applyPetPerformance(event.detail, target)
  }
  const onMessage = (event: Event): void => {
    if (!('data' in event)) {
      return
    }
    const snapshot = snapshotFromReactionMessage((event as { data: unknown }).data)
    if (snapshot === undefined) {
      return
    }
    applyPetPerformance(snapshot, target)
  }
  const detachWindow = (): void => {
    if (typeof target.removeEventListener === 'function') {
      target.removeEventListener(FRIEND_REACTION_EVENT, onCustom)
      target.removeEventListener('message', onMessage)
    }
  }
  if (typeof target.addEventListener === 'function') {
    target.addEventListener(FRIEND_REACTION_EVENT, onCustom)
    target.addEventListener('message', onMessage)
  }

  const Source = options.EventSource ?? globalThis.EventSource
  if (typeof Source !== 'function') {
    ctx.effect?.(() => detachWindow, 'dsh-friend-reactions:client-sse')
    return
  }

  let source: InstanceType<ReactionClientEventSource>
  try {
    source = new Source('/friend/reactions/events')
  } catch {
    detachWindow()
    return
  }
  const onReaction = (event: { data: string }): void => {
    let snapshot: unknown
    try {
      const parsed = JSON.parse(event.data) as { payload?: unknown }
      snapshot = parsed.payload ?? parsed
    } catch {
      return
    }
    present(snapshot)
  }
  source.addEventListener('reaction', onReaction)
  ctx.effect?.(() => () => {
    source.close()
    detachWindow()
  }, 'dsh-friend-reactions:client-sse')
}

function speakVoiceQuip(snapshot: unknown, enqueueTts?: (text: string) => void): void {
  if (snapshot === null || typeof snapshot !== 'object') {
    return
  }
  const record = snapshot as ReactionSnapshotLike
  if (record.level !== 'voice' || typeof record.quip !== 'string' || record.quip.length === 0) {
    return
  }
  if (typeof enqueueTts === 'function') {
    enqueueTts(record.quip)
    return
  }
  enqueueReactionTts(record.quip)
}

export {
  applyPetPerformance,
  dispatchFriendReaction,
  FRIEND_REACTION_EVENT,
  snapshotFromReactionMessage,
} from './dispatch.ts'
export {
  enqueueReactionTts,
  FRIEND_TTS_CLIENT_GLOBAL,
  FRIEND_TTS_PREVIEW_PATH,
} from './enqueue-tts.ts'
export { FRIEND_SETTINGS_NAMESPACES }
