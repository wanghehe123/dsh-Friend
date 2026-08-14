/**
 * Barge-in facade: one `stopAll()` that silences every client playback path.
 *
 * There are two executors — `speechSynthesis` (W-M2-4) and the AudioContext
 * player (W-M2-7). ASR (W-M3-4) MUST call this facade, not either path alone.
 *
 * The well-known global lets the ASR client half invoke us without
 * `require('@wish233/dsh-friend-tts/client')` (that payload is a
 * ModuleLoader factory, not an importable ESM module).
 */

export type FriendTtsStopAll = () => void

/** Installed on `globalThis` so ASR can barge in without importing this package. */
export const FRIEND_TTS_STOP_ALL_GLOBAL = '__dshFriendStopAllTts__' as const

const stops = new Set<FriendTtsStopAll>()

export function registerFriendTtsStop(stop: FriendTtsStopAll): () => void {
  stops.add(stop)
  return () => {
    stops.delete(stop)
  }
}

/** Stop speechSynthesis and AudioContext together. Safe no-op when nothing is mounted. */
export function stopAllFriendTts(): void {
  for (const stop of [...stops]) {
    stop()
  }
}

export function installFriendTtsStopAllGlobal(
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): () => void {
  target[FRIEND_TTS_STOP_ALL_GLOBAL] = stopAllFriendTts
  return () => {
    if (target[FRIEND_TTS_STOP_ALL_GLOBAL] === stopAllFriendTts) {
      delete target[FRIEND_TTS_STOP_ALL_GLOBAL]
    }
  }
}

export function registeredFriendTtsStopCount(): number {
  return stops.size
}
