/**
 * Live mute bus. `friend-tts.muted` / `friend-tts.volume` are the unique
 * playback source; `friend-core.muted` / `volume` and `friend-stage.floatMuted`
 * are write-through aliases so every entry (tray, float menu, config center)
 * lands on the same document TTS actually reads.
 *
 * Immediate silence covers both playback paths:
 * AudioContext via `__DSH_FRIEND_TTS__.stopAll()` / `__dshFriendStopAllTts__`,
 * and `speechSynthesis.cancel()` plus `<audio>/<video>`.
 */
export const FRIEND_MUTE_EVENT = 'dsh-friend:mute' as const
export const FRIEND_UNMUTE_EVENT = 'dsh-friend:unmute' as const
export const FRIEND_PLAYBACK_GLOBAL = '__DSH_FRIEND_PLAYBACK__' as const
export const FRIEND_TTS_CLIENT_GLOBAL = '__DSH_FRIEND_TTS__' as const
export const FRIEND_TTS_STOP_ALL_GLOBAL = '__dshFriendStopAllTts__' as const
export const STAGE_FLOAT_MUTED_FIELD = 'floatMuted' as const
export const TTS_MUTED_FIELD = 'muted' as const
export const TTS_VOLUME_FIELD = 'volume' as const

export type PlaybackFieldWriter = {
  set(field: string, value: unknown): Promise<void>
}

export type FriendPlaybackApi = {
  setMuted(muted: boolean): Promise<void>
  setVolume(volume: number): Promise<void>
  getMuted(): boolean
  stopNow(): void
}

export type MuteBridgeWriters = {
  tts?: PlaybackFieldWriter
  core?: PlaybackFieldWriter
  stage?: PlaybackFieldWriter
}

export type MuteBridgeTarget = {
  addEventListener?(type: string, listener: (event: { type: string }) => void): void
  removeEventListener?(type: string, listener: (event: { type: string }) => void): void
  speechSynthesis?: { cancel(): void }
  document?: {
    querySelectorAll(selector: string): ArrayLike<{ pause?: () => void; muted?: boolean }>
  }
} & Record<string, unknown>

export type InstallMuteBridgeOptions = {
  writers: MuteBridgeWriters
  target?: MuteBridgeTarget
  readMuted?: () => boolean
  readTts?: () => unknown
  subscribeTts?: (listener: () => void) => () => void
}

export function resolvePlaybackKnobs(input: {
  tts?: unknown
  core?: unknown
  stage?: unknown
}): { volume: number; muted: boolean } {
  const tts = asRecord(input.tts)
  const core = asRecord(input.core)
  const stage = asRecord(input.stage)
  const volume = asFiniteNumber(tts?.volume) ?? asFiniteNumber(core?.volume) ?? 1
  const muted = asBoolean(tts?.muted)
    ?? asBoolean(core?.muted)
    ?? (stage?.floatMuted === true)
  return {
    volume: clampVolume(volume),
    muted: muted === true,
  }
}

export function applyLiveMute(muted: boolean, target: MuteBridgeTarget = globalThis as MuteBridgeTarget): void {
  if (muted) {
    const tts = target[FRIEND_TTS_CLIENT_GLOBAL]
    if (isRecord(tts) && typeof tts.stopAll === 'function') {
      tts.stopAll()
    }
    const stopAll = target[FRIEND_TTS_STOP_ALL_GLOBAL]
    if (typeof stopAll === 'function') {
      stopAll()
    }
    target.speechSynthesis?.cancel()
  }
  const media = target.document?.querySelectorAll('audio, video')
  if (media !== undefined) {
    for (let index = 0; index < media.length; index += 1) {
      const element = media[index]
      if (element === undefined) {
        continue
      }
      if (muted) {
        element.pause?.()
        element.muted = true
      } else {
        element.muted = false
      }
    }
  }
}

export async function persistPlaybackMute(
  writers: MuteBridgeWriters,
  muted: boolean,
): Promise<void> {
  if (writers.tts !== undefined) {
    await writers.tts.set(TTS_MUTED_FIELD, muted)
  }
  if (writers.core !== undefined) {
    await writers.core.set(TTS_MUTED_FIELD, muted)
  }
  if (writers.stage !== undefined) {
    await writers.stage.set(STAGE_FLOAT_MUTED_FIELD, muted)
  }
}

export async function persistPlaybackVolume(
  writers: MuteBridgeWriters,
  volume: number,
): Promise<void> {
  const next = clampVolume(volume)
  if (writers.tts !== undefined) {
    await writers.tts.set(TTS_VOLUME_FIELD, next)
  }
  if (writers.core !== undefined) {
    await writers.core.set(TTS_VOLUME_FIELD, next)
  }
}

export function installMuteBridge(options: InstallMuteBridgeOptions): () => void {
  const target = options.target ?? (globalThis as MuteBridgeTarget)
  let muted = options.readMuted?.() === true
  let applying = false

  const syncFromTts = (persistAliases: boolean): void => {
    if (options.readTts === undefined) {
      return
    }
    const knobs = resolvePlaybackKnobs({ tts: options.readTts() })
    muted = knobs.muted
    applyLiveMute(knobs.muted, target)
    if (!persistAliases || applying) {
      return
    }
    applying = true
    void persistPlaybackAliases(options.writers, knobs).finally(() => {
      applying = false
    })
  }

  const api: FriendPlaybackApi = {
    async setMuted(next) {
      muted = next
      applyLiveMute(next, target)
      if (applying) {
        return
      }
      applying = true
      try {
        await persistPlaybackMute(options.writers, next)
      } finally {
        applying = false
      }
    },
    async setVolume(volume) {
      if (applying) {
        return
      }
      applying = true
      try {
        await persistPlaybackVolume(options.writers, volume)
      } finally {
        applying = false
      }
    },
    getMuted() {
      return muted
    },
    stopNow() {
      applyLiveMute(true, target)
    },
  }

  target[FRIEND_PLAYBACK_GLOBAL] = api

  const onMute = (): void => {
    void api.setMuted(true)
  }
  const onUnmute = (): void => {
    void api.setMuted(false)
  }
  target.addEventListener?.(FRIEND_MUTE_EVENT, onMute)
  target.addEventListener?.(FRIEND_UNMUTE_EVENT, onUnmute)
  const unsubscribeTts = options.subscribeTts?.(() => {
    syncFromTts(true)
  })
  syncFromTts(false)

  return () => {
    unsubscribeTts?.()
    target.removeEventListener?.(FRIEND_MUTE_EVENT, onMute)
    target.removeEventListener?.(FRIEND_UNMUTE_EVENT, onUnmute)
    if (target[FRIEND_PLAYBACK_GLOBAL] === api) {
      delete target[FRIEND_PLAYBACK_GLOBAL]
    }
  }
}

async function persistPlaybackAliases(
  writers: MuteBridgeWriters,
  knobs: { volume: number; muted: boolean },
): Promise<void> {
  if (writers.core !== undefined) {
    await writers.core.set(TTS_MUTED_FIELD, knobs.muted)
    await writers.core.set(TTS_VOLUME_FIELD, knobs.volume)
  }
  if (writers.stage !== undefined) {
    await writers.stage.set(STAGE_FLOAT_MUTED_FIELD, knobs.muted)
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 1
  }
  return Math.min(1, Math.max(0, value))
}
