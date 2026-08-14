/**
 * Approximate mouth drive for `speechSynthesis`. There is no PCM, so this
 * cannot match phonemes. It pulses a 0–1 envelope and spikes on `onboundary`.
 *
 * Limits: CJK voices often omit word boundaries; timing drifts vs real speech;
 * the envelope is a metronome, not an RMS of audio.
 */

import { dispatchFriendLipsync } from './lipsync.ts'

export const FRIEND_FALLBACK_LIPSYNC_HZ = 5
export const FRIEND_FALLBACK_LIPSYNC_PULSE = 0.48
export const FRIEND_FALLBACK_LIPSYNC_BOUNDARY = 0.72

export type FallbackLipsyncDriver = {
  start(text: string, rate?: number): void
  onBoundary(): void
  stop(): void
}

export type CreateFallbackLipsyncDriverOptions = {
  dispatch?: (level: number) => void
  setInterval?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void
}

export function createFallbackLipsyncDriver(
  options: CreateFallbackLipsyncDriverOptions = {},
): FallbackLipsyncDriver {
  const dispatch = options.dispatch ?? dispatchFriendLipsync
  const schedule = options.setInterval ?? ((handler, ms) => setInterval(handler, ms))
  const unschedule = options.clearInterval ?? ((handle) => clearInterval(handle))
  let timer: ReturnType<typeof setInterval> | undefined
  let phase = 0

  const halt = (closeMouth: boolean): void => {
    if (timer !== undefined) {
      unschedule(timer)
      timer = undefined
    }
    if (closeMouth) {
      dispatch(0)
    }
  }

  return {
    start(_text, _rate) {
      halt(false)
      phase = 0
      const ms = Math.round(1000 / FRIEND_FALLBACK_LIPSYNC_HZ)
      timer = schedule(() => {
        phase += 1
        const open = phase % 2 === 1
        const variation = 0.08 * Math.sin(phase)
        dispatch(open ? Math.min(1, FRIEND_FALLBACK_LIPSYNC_PULSE + variation) : 0.12)
      }, ms)
    },
    onBoundary() {
      dispatch(FRIEND_FALLBACK_LIPSYNC_BOUNDARY)
    },
    stop() {
      halt(true)
    },
  }
}
