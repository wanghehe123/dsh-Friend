/**
 * Host-side OpenAI-compatible transcription proxy.
 * Key stays in the host closure; errors are redacted; timeout is 60 s.
 */
export const ASR_TRANSCRIBE_TIMEOUT_MS = 60_000
export const ASR_TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024
export const OPENAI_TRANSCRIPTIONS_PATH = '/audio/transcriptions'

export type AsrProxyCredentials = {
  apiKey?: string
  baseURL?: string
  model?: string
}

export type AsrProxyRequest = {
  audio: Uint8Array
  mime?: string
  filename?: string
  language?: string
}

export type AsrProxyResult = {
  text: string
}

export type AsrTranscribeProxy = {
  transcribe(request: AsrProxyRequest): Promise<AsrProxyResult>
}

export type CreateAsrTranscribeProxyOptions = {
  getCredentials?: () => AsrProxyCredentials | undefined
  fetch?: typeof fetch
  timeoutMs?: number
}

export function createAsrTranscribeProxy(options: CreateAsrTranscribeProxyOptions = {}): AsrTranscribeProxy {
  const timeoutMs = options.timeoutMs ?? ASR_TRANSCRIBE_TIMEOUT_MS
  const fetchFn = options.fetch ?? fetch

  return {
    async transcribe(request) {
      const credentials = options.getCredentials?.() ?? {}
      const apiKey = credentials.apiKey?.trim() ?? ''
      const baseURL = trimSlash(credentials.baseURL ?? '')
      const model = credentials.model?.trim() || 'whisper-1'
      if (baseURL.length === 0) {
        throw new Error('asr-endpoint: missing base URL')
      }
      if (apiKey.length === 0) {
        throw new Error('asr-endpoint: missing API key')
      }
      if (request.audio.byteLength === 0) {
        throw new Error('asr-endpoint: empty audio body')
      }
      if (request.audio.byteLength > ASR_TRANSCRIBE_MAX_BYTES) {
        throw new Error('asr-endpoint: audio too large')
      }

      const mime = request.mime?.trim() || 'audio/webm'
      const filename = request.filename?.trim() || 'audio.webm'
      const form = new FormData()
      form.append('file', new Blob([copyBuffer(request.audio)], { type: mime }), filename)
      form.append('model', model)
      if (request.language !== undefined && request.language.trim().length > 0) {
        form.append('language', request.language.trim())
      }

      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort()
      }, timeoutMs)
      timer.unref?.()

      let response: Response
      try {
        response = await fetchFn(`${baseURL}${OPENAI_TRANSCRIPTIONS_PATH}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: form,
          signal: controller.signal,
        })
      } catch (error) {
        throw new Error(redact(normalizeFetchError(error), apiKey))
      } finally {
        clearTimeout(timer)
      }

      if (!response.ok) {
        const detail = await readErrorDetail(response)
        throw new Error(redact(`asr-endpoint: HTTP ${String(response.status)} ${detail}`.trim(), apiKey))
      }

      const text = await readTranscript(response)
      return { text }
    },
  }
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/u, '')
}

function normalizeFetchError(error: unknown): string {
  if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))) {
    return 'asr-endpoint: timed out'
  }
  return `asr-endpoint: ${error instanceof Error ? error.message : String(error)}`
}

async function readTranscript(response: Response): Promise<string> {
  const raw = await response.text()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object') {
      const text = (parsed as { text?: unknown }).text
      if (typeof text === 'string') {
        return text
      }
    }
  } catch {
    // plain text body
  }
  return raw.trim()
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
      // not JSON
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
