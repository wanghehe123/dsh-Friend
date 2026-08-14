/**
 * Fan `dsh-friend:reaction` out of the parent frame onto the pet iframe.
 *
 * `__DSH_FRIEND_PET__` is set on the pet page (iframe), not the parent
 * plugin window. A parent-only CustomEvent never reaches `applyPerformance`,
 * so we also walk same-origin `iframe.contentWindow` and `postMessage`.
 */

export const FRIEND_REACTION_EVENT = 'dsh-friend:reaction' as const

export type FriendReactionFrame = {
  dispatchEvent(event: Event): boolean
  postMessage?(data: unknown, origin: string): void
  __DSH_FRIEND_PET__?: {
    applyPerformance?: (snapshot: unknown) => unknown
  }
}

export type FriendReactionTarget = FriendReactionFrame & {
  addEventListener?(type: string, listener: (event: Event) => void): void
  removeEventListener?(type: string, listener: (event: Event) => void): void
  document?: {
    querySelectorAll(selector: string): ArrayLike<{ contentWindow?: FriendReactionFrame | null }>
  }
}

function dispatchOn(frame: FriendReactionFrame, snapshot: unknown): void {
  if (typeof CustomEvent === 'function') {
    frame.dispatchEvent(new CustomEvent(FRIEND_REACTION_EVENT, { detail: snapshot }))
  }
  try {
    frame.postMessage?.({ type: FRIEND_REACTION_EVENT, snapshot }, '*')
  } catch {
    // cross-origin or missing postMessage
  }
}

export function applyPetPerformance(
  snapshot: unknown,
  target: FriendReactionTarget = globalThis as unknown as FriendReactionTarget,
): boolean {
  let applied = false
  const local = target.__DSH_FRIEND_PET__
  if (typeof local?.applyPerformance === 'function') {
    local.applyPerformance(snapshot)
    applied = true
  }
  const frames = target.document?.querySelectorAll?.('iframe')
  if (frames === undefined) {
    return applied
  }
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]?.contentWindow
    if (frame === undefined || frame === null) {
      continue
    }
    try {
      const pet = frame.__DSH_FRIEND_PET__
      if (typeof pet?.applyPerformance === 'function') {
        pet.applyPerformance(snapshot)
        applied = true
      }
    } catch {
      // sandboxed / cross-origin iframe
    }
  }
  return applied
}

export function dispatchFriendReaction(
  snapshot: unknown,
  target: FriendReactionTarget = globalThis as unknown as FriendReactionTarget,
): void {
  if (typeof target.dispatchEvent !== 'function') {
    return
  }
  dispatchOn(target, snapshot)
  const frames = target.document?.querySelectorAll?.('iframe')
  if (frames === undefined) {
    return
  }
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]?.contentWindow
    if (frame === undefined || frame === null) {
      continue
    }
    try {
      dispatchOn(frame, snapshot)
    } catch {
      // sandboxed / cross-origin iframe
    }
  }
}

export function snapshotFromReactionMessage(data: unknown): unknown {
  if (data === null || typeof data !== 'object') {
    return undefined
  }
  const record = data as { type?: unknown; snapshot?: unknown; detail?: unknown }
  if (record.type !== FRIEND_REACTION_EVENT) {
    return undefined
  }
  return record.snapshot ?? record.detail
}
