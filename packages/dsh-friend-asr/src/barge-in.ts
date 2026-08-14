/**
 * ASR barge-in looks up the TTS facade installed on `globalThis`.
 * The ASR client half cannot import the TTS client ModuleLoader payload.
 * The well-known name is kept in sync with `dsh-friend-tts/src/stop-all.ts`.
 */
export const FRIEND_TTS_STOP_ALL_GLOBAL = '__dshFriendStopAllTts__' as const

export function invokeFriendTtsStopAll(
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): void {
  const stop = target[FRIEND_TTS_STOP_ALL_GLOBAL]
  if (typeof stop === 'function') {
    stop()
  }
}
