/**
 * OpenAI-compatible TTS: `POST {base}/audio/speech`.
 *
 * The API key is closed over via {@link OpenAiCompatProviderOptions.getCredentials}
 * (host settings). It MUST NOT appear on `FriendTtsSynthesizeOpts`, in thrown
 * messages, or in any client-readable snapshot.
 *
 * Failures throw so the W-M2-1 router can degrade. This module does not
 * surface UI errors.
 */

import { OPENAI_COMPAT_VOICES } from '../voices.ts'
import {
  FRIEND_TTS_OPENAI_COMPAT_PROVIDER,
  type FriendTtsProvider,
  type FriendTtsSynthesizeOpts,
} from '../seam.ts'

export const OPENAI_COMPAT_PROVIDER_ID = FRIEND_TTS_OPENAI_COMPAT_PROVIDER
export const OPENAI_COMPAT_DEFAULT_VOICE = 'alloy'
export const OPENAI_COMPAT_DEFAULT_MODEL = 'tts-1'
export const OPENAI_COMPAT_DEFAULT_FORMAT = 'mp3'
export const OPENAI_COMPAT_TIMEOUT_MS = 15_000
export const OPENAI_COMPAT_PATH = '/audio/speech'

export { OPENAI_COMPAT_VOICES } from '../voices.ts'

export type OpenAiCompatCredentials = {
  apiKey?: string
  baseURL?: string
  model?: string
  format?: string
}

export type OpenAiCompatProviderOptions = {
  /** Live host credentials. Called on every synthesize — never cache the key. */
  getCredentials?: () => OpenAiCompatCredentials | undefined
  fetch?: typeof fetch
  timeoutMs?: number
  voice?: string
  model?: string
}

const SPEED_MIN = 0.25
const SPEED_MAX = 4

const FORMAT_MIME: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/pcm',
}

export function createOpenAiCompatProvider(options: OpenAiCompatProviderOptions = {}): FriendTtsProvider {
  const timeoutMs = options.timeoutMs ?? OPENAI_COMPAT_TIMEOUT_MS
  const fetchFn = options.fetch ?? fetch
  const defaultVoice = options.voice ?? OPENAI_COMPAT_DEFAULT_VOICE
  const defaultModel = options.model ?? OPENAI_COMPAT_DEFAULT_MODEL

  return {
    id: OPENAI_COMPAT_PROVIDER_ID,

    async listVoices() {
      return OPENAI_COMPAT_VOICES
    },

    async synthesize(text, opts) {
      const trimmed = text.trim()
      if (trimmed.length === 0) {
        throw new Error('openai-compat: refused empty text')
      }

      const credentials = options.getCredentials?.() ?? {}
      const apiKey = credentials.apiKey?.trim() ?? ''
      const baseURL = trimSlash(opts?.baseURL ?? credentials.baseURL ?? '')
      const model = opts?.model ?? credentials.model ?? defaultModel
      const voice = opts?.voice ?? defaultVoice
      const format = normalizeFormat(opts?.format ?? credentials.format)
      const speed = mapRateToSpeed(opts?.rate)

      if (baseURL.length === 0) {
        throw new Error('openai-compat: missing base URL')
      }
      if (apiKey.length === 0) {
        throw new Error('openai-compat: missing API key')
      }

      const url = `${baseURL}${OPENAI_COMPAT_PATH}`
      const body = JSON.stringify({
        model,
        input: trimmed,
        voice,
        response_format: format,
        speed,
      })

      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort()
      }, timeoutMs)
      timer.unref?.()

      let response: Response
      try {
        response = await fetchFn(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: controller.signal,
        })
      } catch (error) {
        throw new Error(redact(normalizeFetchError(error), apiKey))
      } finally {
        clearTimeout(timer)
      }

      if (!response.ok) {
        const detail = await readErrorDetail(response)
        throw new Error(redact(`openai-compat: HTTP ${String(response.status)} ${detail}`.trim(), apiKey))
      }

      const audio = Buffer.from(await response.arrayBuffer())
      if (audio.byteLength === 0) {
        throw new Error('openai-compat: empty audio body')
      }

      const mime = contentTypeOf(response, format)
      return { audio, mime }
    },
  }
}

export function mapRateToSpeed(rate: number | undefined): number {
  if (rate === undefined || !Number.isFinite(rate)) {
    return 1
  }
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, rate))
}

export function openaiSpeechUrl(baseURL: string): string {
  return `${trimSlash(baseURL)}${OPENAI_COMPAT_PATH}`
}

function normalizeFormat(format: string | undefined): string {
  const raw = format?.trim().toLowerCase() ?? OPENAI_COMPAT_DEFAULT_FORMAT
  return raw in FORMAT_MIME ? raw : OPENAI_COMPAT_DEFAULT_FORMAT
}

function contentTypeOf(response: Response, format: string): string {
  const header = response.headers.get('content-type')
  if (header !== null && header.length > 0 && !header.includes('application/json')) {
    return header.split(';')[0]?.trim() || FORMAT_MIME[format] || 'audio/mpeg'
  }
  return FORMAT_MIME[format] ?? 'audio/mpeg'
}

function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/u, '')
}

function normalizeFetchError(error: unknown): string {
  if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))) {
    return 'openai-compat: timed out'
  }
  return `openai-compat: ${error instanceof Error ? error.message : String(error)}`
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text()
    if (text.length === 0) {
      return response.statusText
    }
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed !== null && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>
        const nested = isRecord(record.error) ? record.error : undefined
        const message = asNonEmptyString(record.message)
          ?? (nested !== undefined ? asNonEmptyString(nested.message) : undefined)
        if (message !== undefined) {
          return message
        }
      }
    } catch {
      // not JSON — fall through
    }
    return text.slice(0, 200)
  } catch {
    return response.statusText
  }
}

function redact(message: string, apiKey: string): string {
  if (apiKey.length === 0) {
    return message
  }
  return message.split(apiKey).join('[redacted]')
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

export type { FriendTtsSynthesizeOpts }
