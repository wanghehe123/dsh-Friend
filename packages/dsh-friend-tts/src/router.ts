/**
 * Route a synthesis request through the registered providers.
 *
 * Chain: preferred (from live config) → remaining registered providers
 * (skipping the `browser` marker) → browser-fallback instruction.
 * Provider throws are logged and never rethrown — the session stays up.
 */

import {
  createBrowserFallbackInstruction,
  type FriendTtsBrowserFallback,
  type FriendTtsFailedProvider,
} from './providers/browser.ts'
import {
  FRIEND_TTS_BROWSER_PROVIDER,
  FRIEND_TTS_DEFAULT_PROVIDER,
  type FriendTtsAudio,
  type FriendTtsProvider,
  type FriendTtsRegistry,
  type FriendTtsSynthesizeOpts,
} from './seam.ts'

export type { FriendTtsBrowserFallback, FriendTtsFailedProvider }

export type FriendTtsLog = (message: string) => void

export interface FriendTtsConfig {
  /** Preferred provider id. Read on every synthesize; default `edge`. */
  provider?: string
  voice?: string
  rate?: number
  pitch?: number
  autoSpeak?: boolean
  stripStageDirections?: boolean
  volume?: number
  muted?: boolean
}

export type FriendTtsConfigSource = () => FriendTtsConfig | undefined

export interface FriendTtsAudioResult extends FriendTtsAudio {
  kind: 'audio'
  providerId: string
}

export type FriendTtsRouteResult = FriendTtsAudioResult | FriendTtsBrowserFallback

export interface FriendTtsRouter {
  synthesize(text: string, opts?: FriendTtsSynthesizeOpts): Promise<FriendTtsRouteResult>
}

export interface CreateFriendTtsRouterOptions {
  registry: FriendTtsRegistry
  getConfig: FriendTtsConfigSource
  log?: FriendTtsLog
}

export function createFriendTtsRouter(options: CreateFriendTtsRouterOptions): FriendTtsRouter {
  const log = options.log ?? defaultLog

  return {
    async synthesize(text, opts) {
      let config: FriendTtsConfig = {}
      try {
        config = options.getConfig() ?? {}
      } catch (error) {
        log(`dsh-friend-tts: failed to read TTS config (${cause(error)}); using defaults`)
      }

      const merged = mergeOpts(config, opts)
      const pinned = asNonEmptyString(opts?.provider)
      const preferred = pinned ?? (config.provider?.trim() || FRIEND_TTS_DEFAULT_PROVIDER)
      const failed: FriendTtsFailedProvider[] = []

      if (preferred === FRIEND_TTS_BROWSER_PROVIDER) {
        return createBrowserFallbackInstruction(text, merged, 'provider set to browser', failed)
      }

      for (const provider of buildChain(options.registry, preferred, pinned !== undefined)) {
        try {
          const audio = await provider.synthesize(text, merged)
          return {
            kind: 'audio',
            providerId: provider.id,
            audio: audio.audio,
            mime: audio.mime,
          }
        } catch (error) {
          const message = cause(error)
          failed.push({ id: provider.id, error: message })
          log(`dsh-friend-tts: provider "${provider.id}" failed (${message}); falling back`)
        }
      }

      const reason = failed.length === 0
        ? `no synthesizer registered for "${preferred}"`
        : `all synthesizers failed (preferred "${preferred}")`
      return createBrowserFallbackInstruction(text, merged, reason, failed)
    },
  }
}

export function readFriendTtsConfig(raw: unknown): FriendTtsConfig {
  if (!isRecord(raw)) {
    return {}
  }
  const config: FriendTtsConfig = {}
  const provider = asNonEmptyString(raw.provider)
  if (provider !== undefined) {
    config.provider = provider
  }
  const voice = asNonEmptyString(raw.voice)
  if (voice !== undefined) {
    config.voice = voice
  }
  const rate = asFiniteNumber(raw.rate)
  if (rate !== undefined) {
    config.rate = rate
  }
  const pitch = asFiniteNumber(raw.pitch)
  if (pitch !== undefined) {
    config.pitch = pitch
  }
  const autoSpeak = asBoolean(raw.autoSpeak)
  if (autoSpeak !== undefined) {
    config.autoSpeak = autoSpeak
  }
  const stripStageDirections = asBoolean(raw.stripStageDirections)
  if (stripStageDirections !== undefined) {
    config.stripStageDirections = stripStageDirections
  }
  const volume = asFiniteNumber(raw.volume)
  if (volume !== undefined) {
    config.volume = volume
  }
  const muted = asBoolean(raw.muted)
  if (muted !== undefined) {
    config.muted = muted
  }
  return config
}

function buildChain(
  registry: FriendTtsRegistry,
  preferred: string,
  pinned = false,
): FriendTtsProvider[] {
  const listed = registry.list()
  const head = listed.find((provider) => provider.id === preferred)
  if (pinned) {
    return head === undefined || head.id === FRIEND_TTS_BROWSER_PROVIDER ? [] : [head]
  }
  const rest = listed.filter(
    (provider) => provider.id !== preferred && provider.id !== FRIEND_TTS_BROWSER_PROVIDER,
  )
  return head === undefined ? rest : [head, ...rest]
}

function mergeOpts(config: FriendTtsConfig, opts: FriendTtsSynthesizeOpts | undefined): FriendTtsSynthesizeOpts {
  return {
    ...(config.voice !== undefined ? { voice: config.voice } : {}),
    ...(config.rate !== undefined ? { rate: config.rate } : {}),
    ...(config.pitch !== undefined ? { pitch: config.pitch } : {}),
    ...opts,
  }
}

function defaultLog(message: string): void {
  console.warn(message)
}

function cause(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}
