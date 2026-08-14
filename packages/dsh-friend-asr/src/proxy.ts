/**
 * Host-side OpenAI-compatible transcription proxy.
 * Key stays in the host closure; errors are redacted; timeout is 60 s.
 */
export const ASR_TRANSCRIBE_TIMEOUT_MS = 60_000
export const ASR_TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024
export const OPENAI_TRANSCRIPTIONS_PATH = '/audio/transcriptions'
export const DASHSCOPE_MULTIMODAL_GENERATION_PATH = '/services/aigc/multimodal-generation/generation'
export const DASHSCOPE_QWEN_ASR_MAX_DATA_URL_BYTES = 10 * 1024 * 1024

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
      const dashScopeQwen = isDashScopeQwen3Asr(baseURL, model)
      if (
        dashScopeQwen
        && dashScopeDataUrlByteLength(request.audio.byteLength, mime) > DASHSCOPE_QWEN_ASR_MAX_DATA_URL_BYTES
      ) {
        throw new Error('asr-endpoint: DashScope audio too large after Base64 encoding')
      }
      const target = dashScopeQwen
        ? `${baseURL}${DASHSCOPE_MULTIMODAL_GENERATION_PATH}`
        : `${baseURL}${OPENAI_TRANSCRIPTIONS_PATH}`
      const body = dashScopeQwen
        ? dashScopeQwenBody(request.audio, mime, model, request.language)
        : openAiTranscriptionBody(request, mime, model)
      const headers = dashScopeQwen
        ? {
            Authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          }
        : {
            Authorization: `Bearer ${apiKey}`,
          }

      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort()
      }, timeoutMs)
      timer.unref?.()

      let response: Response
      try {
        response = await fetchFn(target, {
          method: 'POST',
          headers,
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
        throw new Error(redact(`asr-endpoint: HTTP ${String(response.status)} ${detail}`.trim(), apiKey))
      }

      const text = dashScopeQwen
        ? await readDashScopeTranscript(response)
        : await readTranscript(response)
      return { text }
    },
  }
}

function openAiTranscriptionBody(
  request: AsrProxyRequest,
  mime: string,
  model: string,
): FormData {
  const filename = request.filename?.trim() || 'audio.webm'
  const form = new FormData()
  form.append('file', new Blob([copyBuffer(request.audio)], { type: mime }), filename)
  form.append('model', model)
  if (request.language !== undefined && request.language.trim().length > 0) {
    form.append('language', request.language.trim())
  }
  return form
}

function isDashScopeQwen3Asr(baseURL: string, model: string): boolean {
  if (!/\/api\/v1$/iu.test(baseURL)) {
    return false
  }
  const normalized = model.toLowerCase()
  if (normalized === 'qwen3-asr-flash' || normalized === 'qwen3-asr-flash-us') {
    return true
  }
  return /^qwen3-asr-flash-\d{4}-\d{2}-\d{2}(?:-us)?$/u.test(normalized)
}

function dashScopeDataUrlByteLength(audioBytes: number, mime: string): number {
  const prefixBytes = Buffer.byteLength(`data:${mime};base64,`)
  return prefixBytes + (4 * Math.ceil(audioBytes / 3))
}

function dashScopeQwenBody(
  audio: Uint8Array,
  mime: string,
  model: string,
  language: string | undefined,
): string {
  const normalizedLanguage = normalizeQwenLanguage(language)
  return JSON.stringify({
    model,
    input: {
      messages: [{
        role: 'user',
        content: [{
          audio: `data:${mime};base64,${Buffer.from(audio).toString('base64')}`,
        }],
      }],
    },
    parameters: {
      asr_options: {
        ...(normalizedLanguage === undefined ? {} : { language: normalizedLanguage }),
        enable_itn: false,
      },
    },
  })
}

function normalizeQwenLanguage(language: string | undefined): string | undefined {
  const normalized = language?.trim().toLowerCase()
  if (normalized === undefined || normalized.length === 0) {
    return undefined
  }
  return normalized.split('-')[0]
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

async function readDashScopeTranscript(response: Response): Promise<string> {
  const payload: unknown = await response.json()
  if (!isRecord(payload)) {
    throw new Error('asr-endpoint: invalid DashScope response')
  }
  const output = isRecord(payload.output) ? payload.output : undefined
  const choices = Array.isArray(output?.choices) ? output.choices : []
  const choice = choices.find(isRecord)
  const message = choice !== undefined && isRecord(choice.message) ? choice.message : undefined
  const content = Array.isArray(message?.content) ? message.content : []
  for (const item of content) {
    if (!isRecord(item)) {
      continue
    }
    const text = asNonEmptyString(item.text)
    if (text !== undefined) {
      return text
    }
  }
  throw new Error('asr-endpoint: missing transcript in DashScope response')
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
