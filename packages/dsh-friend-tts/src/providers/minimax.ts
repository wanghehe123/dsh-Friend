/**
 * MiniMax official TTS: `POST {base}/t2a_v2`.
 *
 * Non-stream JSON returns hex-encoded audio in `data.audio`.
 * The API key stays in the host closure.
 */

import {
  FRIEND_TTS_MINIMAX_PROVIDER,
  type FriendTtsProvider,
  type FriendTtsSynthesizeOpts,
} from '../seam.ts'
import { MINIMAX_VOICES } from '../voices.ts'
import {
  asNonEmptyString,
  isRecord,
  normalizeFetchError,
  readErrorDetail,
  redact,
  startDeadline,
  trimSlash,
} from './http.ts'

export const MINIMAX_PROVIDER_ID = FRIEND_TTS_MINIMAX_PROVIDER
export const MINIMAX_DEFAULT_VOICE = 'male-qn-qingse'
export const MINIMAX_DEFAULT_MODEL = 'speech-2.8-hd'
export const MINIMAX_DEFAULT_FORMAT = 'mp3'
export const MINIMAX_DEFAULT_BASE_URL = 'https://api.minimaxi.com/v1'
export const MINIMAX_TIMEOUT_MS = 20_000
export const MINIMAX_PATH = '/t2a_v2'

export { MINIMAX_VOICES } from '../voices.ts'

export type MiniMaxCredentials = {
  apiKey?: string
  baseURL?: string
  model?: string
  format?: string
}

export type MiniMaxProviderOptions = {
  getCredentials?: () => MiniMaxCredentials | undefined
  fetch?: typeof fetch
  timeoutMs?: number
  voice?: string
  model?: string
}

const SPEED_MIN = 0.5
const SPEED_MAX = 2
const PITCH_MIN = -12
const PITCH_MAX = 12

const FORMAT_MIME: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  pcm: 'audio/pcm',
  flac: 'audio/flac',
  wav: 'audio/wav',
}

export function createMiniMaxTtsProvider(options: MiniMaxProviderOptions = {}): FriendTtsProvider {
  const timeoutMs = options.timeoutMs ?? MINIMAX_TIMEOUT_MS
  const fetchFn = options.fetch ?? fetch
  const defaultVoice = options.voice ?? MINIMAX_DEFAULT_VOICE
  const defaultModel = options.model ?? MINIMAX_DEFAULT_MODEL

  return {
    id: MINIMAX_PROVIDER_ID,

    async listVoices() {
      return MINIMAX_VOICES
    },

    async synthesize(text, opts) {
      const trimmed = text.trim()
      if (trimmed.length === 0) {
        throw new Error('minimax: refused empty text')
      }

      const credentials = options.getCredentials?.() ?? {}
      const apiKey = credentials.apiKey?.trim() ?? ''
      const baseURL = trimSlash(opts?.baseURL ?? credentials.baseURL ?? '')
      const model = opts?.model ?? credentials.model ?? defaultModel
      const voice = opts?.voice ?? defaultVoice
      const format = normalizeFormat(opts?.format ?? credentials.format)

      if (baseURL.length === 0) {
        throw new Error('minimax: missing base URL')
      }
      if (apiKey.length === 0) {
        throw new Error('minimax: missing API key')
      }

      const url = `${baseURL}${MINIMAX_PATH}`
      const body = JSON.stringify({
        model,
        text: trimmed,
        stream: false,
        output_format: 'hex',
        voice_setting: {
          voice_id: voice,
          speed: mapRateToMiniMaxSpeed(opts?.rate),
          vol: 1,
          pitch: mapPitchToMiniMax(opts?.pitch),
        },
        audio_setting: {
          format,
        },
      })

      const deadline = startDeadline(timeoutMs)
      try {
        const response = await fetchFn(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: deadline.signal,
        })
        if (!response.ok) {
          const detail = await readErrorDetail(response)
          throw new Error(redact(`minimax: HTTP ${String(response.status)} ${detail}`.trim(), apiKey))
        }
        const payload: unknown = await response.json()
        return audioFromMiniMax(payload, format, apiKey)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('minimax:')) {
          throw error
        }
        throw new Error(redact(normalizeFetchError(error, 'minimax'), apiKey))
      } finally {
        deadline.dispose()
      }
    },
  }
}

export function mapRateToMiniMaxSpeed(rate: number | undefined): number {
  if (rate === undefined || !Number.isFinite(rate)) {
    return 1
  }
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, rate))
}

export function mapPitchToMiniMax(pitch: number | undefined): number {
  if (pitch === undefined || !Number.isFinite(pitch)) {
    return 0
  }
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, Math.round((pitch - 1) * 12)))
}

export function decodeMiniMaxHex(hex: string): Buffer {
  const cleaned = hex.replace(/\s+/gu, '')
  if (cleaned.length === 0 || cleaned.length % 2 !== 0 || /[^0-9a-f]/iu.test(cleaned)) {
    throw new Error('minimax: invalid hex audio')
  }
  return Buffer.from(cleaned, 'hex')
}

function audioFromMiniMax(
  payload: unknown,
  format: string,
  apiKey: string,
): { audio: Buffer; mime: string } {
  if (!isRecord(payload)) {
    throw new Error('minimax: invalid JSON body')
  }
  const resp = isRecord(payload.base_resp) ? payload.base_resp : undefined
  const status = typeof resp?.status_code === 'number' ? resp.status_code : 0
  if (status !== 0) {
    const detail = asNonEmptyString(resp?.status_msg) ?? 'request failed'
    throw new Error(redact(`minimax: ${String(status)} ${detail}`.trim(), apiKey))
  }
  const data = isRecord(payload.data) ? payload.data : undefined
  const hex = asNonEmptyString(data?.audio)
  if (hex === undefined) {
    throw new Error('minimax: empty audio body')
  }
  const extra = isRecord(payload.extra_info) ? payload.extra_info : undefined
  const reported = asNonEmptyString(extra?.audio_format)?.toLowerCase()
  const mime = (reported !== undefined && reported in FORMAT_MIME)
    ? FORMAT_MIME[reported]
    : FORMAT_MIME[format]
  return { audio: decodeMiniMaxHex(hex), mime: mime ?? 'audio/mpeg' }
}

function normalizeFormat(format: string | undefined): string {
  const raw = format?.trim().toLowerCase() ?? MINIMAX_DEFAULT_FORMAT
  return raw in FORMAT_MIME ? raw : MINIMAX_DEFAULT_FORMAT
}

export type { FriendTtsSynthesizeOpts }
