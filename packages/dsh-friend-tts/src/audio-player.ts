/**
 * Client AudioContext player: sequential queue, first-sound as soon as the
 * head item decodes, ~30 Hz RMS energy pump, volume/mute, `stopAll()`.
 *
 * Format helpers (`detectAudioContainer`, `repairWavHeaders`) are ported
 * from Kokoro-Engine `src/lib/audio-player.ts` together with those tests.
 */
import { detectAudioContainer, repairWavHeaders, rmsFromTimeDomain } from './audio-format.ts'

export { detectAudioContainer, repairWavHeaders, rmsFromTimeDomain, sineTimeDomainBytes } from './audio-format.ts'

export const FRIEND_TTS_ENERGY_HZ = 30
export const FRIEND_TTS_ENERGY_INTERVAL_MS = Math.round(1000 / FRIEND_TTS_ENERGY_HZ)

export type FriendTtsEnergySample = {
  rms: number
  at: number
}

export type FriendTtsPlayItem = {
  id?: string
  bytes: Uint8Array
  mime?: string
}

export type FriendAnalyserLike = {
  fftSize: number
  frequencyBinCount: number
  connect(dest: unknown): void
  getByteTimeDomainData(array: Uint8Array): void
}

export type FriendGainLike = {
  gain: { value: number }
  connect(dest: unknown): void
}

export type FriendBufferSourceLike = {
  buffer: unknown
  connect(dest: unknown): void
  disconnect(): void
  start(): void
  stop(): void
  onended: (() => void) | null
}

export type FriendAudioBufferLike = {
  duration: number
  length?: number
  sampleRate?: number
}

export type FriendAudioContextLike = {
  state: string
  sampleRate: number
  destination: unknown
  resume(): Promise<void>
  decodeAudioData(buffer: ArrayBuffer): Promise<FriendAudioBufferLike>
  createAnalyser(): FriendAnalyserLike
  createGain(): FriendGainLike
  createBufferSource(): FriendBufferSourceLike
}

export type FriendTtsPlayer = {
  enqueue(item: FriendTtsPlayItem): Promise<void>
  stopAll(): void
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  getVolume(): number
  isMuted(): boolean
  isPlaying(): boolean
  queueSize(): number
  dispose(): void
}

export type CreateFriendTtsPlayerOptions = {
  audioContext?: FriendAudioContextLike
  onEnergy?: (sample: FriendTtsEnergySample) => void
  energyHz?: number
  volume?: number
  muted?: boolean
  now?: () => number
  setInterval?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void
}

type QueuedItem = {
  item: FriendTtsPlayItem
  resolve: () => void
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function readGlobalAudioContext(): FriendAudioContextLike | undefined {
  const ctor = (globalThis as {
    AudioContext?: new () => FriendAudioContextLike
    webkitAudioContext?: new () => FriendAudioContextLike
  }).AudioContext ?? (globalThis as { webkitAudioContext?: new () => FriendAudioContextLike }).webkitAudioContext
  if (ctor === undefined) {
    return undefined
  }
  return new ctor()
}

export function createFriendTtsPlayer(options: CreateFriendTtsPlayerOptions = {}): FriendTtsPlayer {
  const context = options.audioContext ?? readGlobalAudioContext()
  const schedule = options.setInterval ?? ((handler, ms) => setInterval(handler, ms))
  const unschedule = options.clearInterval ?? ((handle) => clearInterval(handle))
  const now = options.now ?? Date.now
  const energyMs = Math.round(1000 / (options.energyHz ?? FRIEND_TTS_ENERGY_HZ))

  const queue: QueuedItem[] = []
  let current: QueuedItem | undefined
  let source: FriendBufferSourceLike | undefined
  let analyser: FriendAnalyserLike | undefined
  let gain: FriendGainLike | undefined
  let energyHandle: ReturnType<typeof setInterval> | undefined
  let volume = clampVolume(options.volume ?? 1)
  let muted = options.muted === true
  let epoch = 0
  let disposed = false
  let playing = false

  const applyGain = (): void => {
    if (gain !== undefined) {
      gain.gain.value = muted ? 0 : volume
    }
  }

  const stopEnergy = (): void => {
    if (energyHandle === undefined) {
      return
    }
    unschedule(energyHandle)
    energyHandle = undefined
  }

  const startEnergy = (): void => {
    if (analyser === undefined || options.onEnergy === undefined || energyHandle !== undefined) {
      return
    }
    const bins = new Uint8Array(analyser.frequencyBinCount)
    energyHandle = schedule(() => {
      if (analyser === undefined) {
        return
      }
      analyser.getByteTimeDomainData(bins)
      options.onEnergy?.({ rms: rmsFromTimeDomain(bins), at: now() })
    }, energyMs)
  }

  const finish = (item: QueuedItem, token: number): void => {
    if (token !== epoch) {
      return
    }
    if (current === item) {
      current = undefined
    }
    if (source !== undefined) {
      try {
        source.onended = null
        source.stop()
        source.disconnect()
      } catch {
        // already stopped
      }
      source = undefined
    }
    playing = false
    stopEnergy()
    item.resolve()
    void pump()
  }

  const pump = async (): Promise<void> => {
    if (disposed || context === undefined || current !== undefined) {
      return
    }
    const item = queue.shift()
    if (item === undefined) {
      return
    }
    current = item
    const token = epoch
    try {
      if (context.state === 'suspended') {
        await context.resume()
      }
      if (token !== epoch) {
        item.resolve()
        return
      }
      analyser ??= context.createAnalyser()
      analyser.fftSize = 256
      gain ??= context.createGain()
      applyGain()
      analyser.connect(gain)
      gain.connect(context.destination)

      const container = detectAudioContainer(item.item.bytes)
      const bytes = container === 'wav' ? repairWavHeaders(item.item.bytes) : item.item.bytes
      const decoded = await context.decodeAudioData(copyToArrayBuffer(bytes))
      if (token !== epoch) {
        item.resolve()
        return
      }
      const next = context.createBufferSource()
      next.buffer = decoded
      next.connect(analyser)
      next.onended = () => {
        finish(item, token)
      }
      source = next
      playing = true
      startEnergy()
      next.start()
    } catch {
      finish(item, token)
    }
  }

  const handle: FriendTtsPlayer = {
    enqueue(item) {
      if (disposed) {
        return Promise.resolve()
      }
      if (context === undefined) {
        return Promise.resolve()
      }
      return new Promise((resolve) => {
        queue.push({ item, resolve })
        void pump()
      })
    },

    stopAll() {
      epoch += 1
      const waiting = queue.splice(0, queue.length)
      if (current !== undefined) {
        waiting.unshift(current)
        current = undefined
      }
      if (source !== undefined) {
        try {
          source.onended = null
          source.stop()
          source.disconnect()
        } catch {
          // already stopped
        }
        source = undefined
      }
      playing = false
      stopEnergy()
      applyGain()
      for (const item of waiting) {
        item.resolve()
      }
    },

    setVolume(next) {
      volume = clampVolume(next)
      applyGain()
    },

    setMuted(next) {
      muted = next
      applyGain()
    },

    getVolume() {
      return volume
    },

    isMuted() {
      return muted
    },

    isPlaying() {
      return playing
    },

    queueSize() {
      return queue.length + (current === undefined ? 0 : 1)
    },

    dispose() {
      disposed = true
      handle.stopAll()
    },
  }

  return handle
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 1
  }
  return Math.min(1, Math.max(0, value))
}
