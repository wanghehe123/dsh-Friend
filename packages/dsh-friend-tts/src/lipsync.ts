/**
 * Dispatch `dsh-friend:lipsync` so the pet page listener (stage `pet.ts`)
 * receives a 0–1 mouth-open level. The Live2D canvas lives in a same-origin
 * iframe; a parent-window CustomEvent does not cross that boundary, so we
 * also fan out onto every reachable iframe `contentWindow`.
 */

export const FRIEND_LIPSYNC_EVENT = 'dsh-friend:lipsync' as const
export const FRIEND_LIPSYNC_LOG_GLOBAL = '__DSH_FRIEND_LIPSYNC_LOG__' as const

export type FriendLipsyncDetail = {
  level: number
}

export type FriendLipsyncFrame = {
  dispatchEvent(event: Event): boolean
  postMessage?(data: unknown, origin: string): void
}

export type FriendLipsyncTarget = FriendLipsyncFrame & {
  document?: {
    querySelectorAll(selector: string): ArrayLike<{ contentWindow?: FriendLipsyncFrame | null }>
  }
  [FRIEND_LIPSYNC_LOG_GLOBAL]?: number[]
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 0
  }
  return Math.min(1, Math.max(0, level))
}

function recordLipsync(target: FriendLipsyncTarget, level: number): void {
  const log = target[FRIEND_LIPSYNC_LOG_GLOBAL]
  if (!Array.isArray(log)) {
    target[FRIEND_LIPSYNC_LOG_GLOBAL] = [level]
    return
  }
  log.push(level)
  if (log.length > 128) {
    log.shift()
  }
}

function dispatchOn(frame: FriendLipsyncFrame, level: number): void {
  if (typeof CustomEvent === 'function') {
    frame.dispatchEvent(new CustomEvent(FRIEND_LIPSYNC_EVENT, { detail: { level } }))
  }
  try {
    frame.postMessage?.({ type: FRIEND_LIPSYNC_EVENT, level }, '*')
  } catch {
    // cross-origin or missing postMessage
  }
}

export function dispatchFriendLipsync(
  level: number,
  target: FriendLipsyncTarget = globalThis as unknown as FriendLipsyncTarget,
): void {
  const clamped = clampLevel(level)
  if (typeof target.dispatchEvent !== 'function') {
    return
  }
  dispatchOn(target, clamped)
  recordLipsync(target, clamped)

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
      dispatchOn(frame, clamped)
    } catch {
      // sandboxed / cross-origin iframe
    }
  }
}
