/**
 * TTS provider seam: the host-side contract every synthesizer implements,
 * plus a disposable registry so providers can be added or removed at runtime.
 *
 * Register / unregister is effect-shaped: `register()` returns a disposer.
 * Re-registering the same id replaces the occupant; the previous disposer
 * becomes a no-op. The router reads config on every call, so switching
 * provider does not require a process restart.
 */

export const FRIEND_TTS_DEFAULT_PROVIDER = 'edge' as const
export const FRIEND_TTS_BROWSER_PROVIDER = 'browser' as const
export const FRIEND_TTS_OPENAI_COMPAT_PROVIDER = 'openai-compat' as const
export const FRIEND_TTS_DASHSCOPE_PROVIDER = 'dashscope' as const
export const FRIEND_TTS_MINIMAX_PROVIDER = 'minimax' as const

export type FriendTtsVoiceGender = 'male' | 'female' | 'neutral'

export interface FriendTtsVoice {
  id: string
  name: string
  language: string
  gender?: FriendTtsVoiceGender
}

/**
 * Per-request options shared by `edge` and the forthcoming `openai-compat`.
 *
 * Common knobs (`voice` / `rate` / `pitch`) are what settings and the
 * queue will pass. Edge maps them onto SSML `<voice>` + `<prosody>`.
 * openai-compat maps `voice` + `rate` onto `POST {base}/audio/speech`
 * (`speed` ← `rate`) and ignores `pitch`.
 *
 * `model` / `format` / `baseURL` are openai-compat-only and ignored by edge.
 * API keys MUST NOT appear here — the openai-compat provider closes over
 * host settings so a key cannot leak through opts, logs, or client push.
 */
export interface FriendTtsSynthesizeOpts {
  /**
   * Pin this synthesizer for this call. Preview uses it so the UI provider
   * is not silently rewritten to the live config / fallback chain.
   */
  provider?: string
  voice?: string
  /** Playback-rate multiplier. `1` is the provider default. Typical 0.5–2. */
  rate?: number
  /** Pitch multiplier. `1` is the provider default. Typical 0.5–2. */
  pitch?: number
  /** openai-compat model id (e.g. `tts-1`). Edge ignores. */
  model?: string
  /** Preferred container (`mp3`, `opus`, `wav`, …). Edge defaults to mp3. */
  format?: string
  /** openai-compat endpoint origin. Edge ignores. */
  baseURL?: string
  extra?: Readonly<Record<string, unknown>>
}

export interface FriendTtsAudio {
  audio: Buffer
  mime: string
}

export interface FriendTtsProvider {
  readonly id: string
  listVoices(): Promise<readonly FriendTtsVoice[]>
  synthesize(text: string, opts?: FriendTtsSynthesizeOpts): Promise<FriendTtsAudio>
}

export type FriendTtsUnregister = () => void

export interface FriendTtsRegistry {
  /** Insert or replace `provider.id`. Returns a disposer that removes only this occupant. */
  register(provider: FriendTtsProvider): FriendTtsUnregister
  get(id: string): FriendTtsProvider | undefined
  /** Registration order (Map insertion order). Replacing an id keeps its position. */
  list(): readonly FriendTtsProvider[]
}

export function createFriendTtsRegistry(): FriendTtsRegistry {
  const providers = new Map<string, FriendTtsProvider>()

  return {
    register(provider) {
      const id = provider.id.trim()
      if (id.length === 0) {
        throw new Error('dsh-friend-tts: provider id must be non-empty')
      }
      providers.set(id, provider)
      return () => {
        if (providers.get(id) === provider) {
          providers.delete(id)
        }
      }
    },
    get(id) {
      return providers.get(id)
    },
    list() {
      return [...providers.values()]
    },
  }
}
