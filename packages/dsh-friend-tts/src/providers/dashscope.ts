/**
 * Alibaba Model Studio (百炼) TTS.
 *
 * Qwen-TTS: POST {root}/services/aigc/multimodal-generation/generation
 * CosyVoice / Qwen-Audio-TTS: POST {root}/services/audio/tts/SpeechSynthesizer
 *
 * Neither path is OpenAI `/audio/speech`. The key stays in the host closure.
 */

import {
  FRIEND_TTS_DASHSCOPE_PROVIDER,
  type FriendTtsProvider,
  type FriendTtsSynthesizeOpts,
} from '../seam.ts'
import { DASHSCOPE_VOICES } from '../voices.ts'
import {
  asNonEmptyString,
  isRecord,
  normalizeFetchError,
  readErrorDetail,
  redact,
  startDeadline,
  trimSlash,
} from './http.ts'

export const DASHSCOPE_PROVIDER_ID = FRIEND_TTS_DASHSCOPE_PROVIDER
export const DASHSCOPE_DEFAULT_VOICE = 'Cherry'
export const DASHSCOPE_DEFAULT_MODEL = 'qwen3-tts-flash'
export const DASHSCOPE_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
export const DASHSCOPE_TIMEOUT_MS = 20_000
export const DASHSCOPE_QWEN_TTS_PATH = '/services/aigc/multimodal-generation/generation'
export const DASHSCOPE_COSYVOICE_PATH = '/services/audio/tts/SpeechSynthesizer'

export { DASHSCOPE_VOICES } from '../voices.ts'

export type DashScopeCredentials = {
  apiKey?: string
  baseURL?: string
  model?: string
  format?: string
}

export type DashScopeProviderOptions = {
  getCredentials?: () => DashScopeCredentials | undefined
  fetch?: typeof fetch
  timeoutMs?: number
  voice?: string
  model?: string
}

const FORMAT_MIME: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/pcm',
}

export function createDashScopeTtsProvider(options: DashScopeProviderOptions = {}): FriendTtsProvider {
  const timeoutMs = options.timeoutMs ?? DASHSCOPE_TIMEOUT_MS
  const fetchFn = options.fetch ?? fetch
  const defaultVoice = options.voice ?? DASHSCOPE_DEFAULT_VOICE
  const defaultModel = options.model ?? DASHSCOPE_DEFAULT_MODEL

  return {
    id: DASHSCOPE_PROVIDER_ID,

    async listVoices() {
      return DASHSCOPE_VOICES
    },

    async synthesize(text, opts) {
      const trimmed = text.trim()
      if (trimmed.length === 0) {
        throw new Error('dashscope: refused empty text')
      }

      const credentials = options.getCredentials?.() ?? {}
      const apiKey = credentials.apiKey?.trim() ?? ''
      const baseURL = opts?.baseURL ?? credentials.baseURL ?? DASHSCOPE_DEFAULT_BASE_URL
      const model = opts?.model ?? credentials.model ?? defaultModel
      const voice = opts?.voice ?? defaultVoice
      const format = normalizeFormat(opts?.format ?? credentials.format)

      if (apiKey.length === 0) {
        throw new Error('dashscope: missing API key')
      }

      const url = dashscopeSpeechUrl(baseURL, model)
      const body = JSON.stringify(isCosyVoiceModel(model)
        ? { model, input: { text: trimmed, voice, format } }
        : { model, input: { text: trimmed, voice } })

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
          throw new Error(redact(`dashscope: HTTP ${String(response.status)} ${detail}`.trim(), apiKey))
        }
        const payload: unknown = await response.json()
        return await audioFromDashScope(payload, fetchFn, deadline.signal, format, apiKey)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('dashscope:')) {
          throw error
        }
        throw new Error(redact(normalizeFetchError(error, 'dashscope'), apiKey))
      } finally {
        deadline.dispose()
      }
    },
  }
}

export function dashscopeSpeechUrl(baseURL: string, model: string): string {
  const root = normalizeDashScopeRoot(baseURL)
  const path = isCosyVoiceModel(model) ? DASHSCOPE_COSYVOICE_PATH : DASHSCOPE_QWEN_TTS_PATH
  return `${root}${path}`
}

export function normalizeDashScopeRoot(url: string): string {
  let root = trimSlash(url)
  if (root.length === 0) {
    return DASHSCOPE_DEFAULT_BASE_URL
  }
  for (const path of [DASHSCOPE_QWEN_TTS_PATH, DASHSCOPE_COSYVOICE_PATH]) {
    if (root.endsWith(path)) {
      root = trimSlash(root.slice(0, -path.length))
      break
    }
  }
  if (root.includes('/compatible-mode')) {
    root = root.replace(/\/compatible-mode(?:\/v1)?$/u, '/api/v1')
  }
  if (/^https?:\/\/[^/]+$/u.test(root)) {
    return `${root}/api/v1`
  }
  return root
}

export function isCosyVoiceModel(model: string): boolean {
  return /^(cosyvoice|qwen-audio)/iu.test(model.trim())
}

async function audioFromDashScope(
  payload: unknown,
  fetchFn: typeof fetch,
  signal: AbortSignal,
  format: string,
  apiKey: string,
): Promise<{ audio: Buffer; mime: string }> {
  const audio = isRecord(payload) && isRecord(payload.output) && isRecord(payload.output.audio)
    ? payload.output.audio
    : undefined
  if (audio === undefined) {
    throw new Error('dashscope: missing output.audio')
  }
  const data = asNonEmptyString(audio.data)
  if (data !== undefined) {
    return { audio: Buffer.from(data, 'base64'), mime: FORMAT_MIME[format] ?? 'audio/wav' }
  }
  const fileUrl = asNonEmptyString(audio.url)
  if (fileUrl === undefined) {
    throw new Error('dashscope: empty audio body')
  }
  const response = await fetchFn(fileUrl, { signal })
  if (!response.ok) {
    throw new Error(redact(`dashscope: audio download HTTP ${String(response.status)}`, apiKey))
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength === 0) {
    throw new Error('dashscope: empty audio body')
  }
  const header = response.headers.get('content-type')
  const mime = header !== null && header.length > 0 && !header.includes('application/json')
    ? header.split(';')[0]?.trim() || FORMAT_MIME[format] || 'audio/wav'
    : FORMAT_MIME[format] ?? 'audio/wav'
  return { audio: bytes, mime }
}

function normalizeFormat(format: string | undefined): string {
  const raw = format?.trim().toLowerCase() ?? 'mp3'
  return raw in FORMAT_MIME ? raw : 'mp3'
}

export type { FriendTtsSynthesizeOpts }
