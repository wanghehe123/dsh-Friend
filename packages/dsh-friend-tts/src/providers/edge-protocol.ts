/**
 * Edge Read Aloud request construction. Pure: no sockets, no network.
 *
 * The WSS endpoint and TrustedClientToken are the public Edge Read Aloud
 * surface (not a user API key). Sec-MS-GEC is a time-windowed SHA-256 of
 * that token — required since 2024 or the handshake is rejected.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto'

export const EDGE_DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'
export const EDGE_PROVIDER_ID = 'edge'
export const EDGE_TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
export const EDGE_WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
export const EDGE_VOICES_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list'
export const EDGE_SEC_MS_GEC_VERSION = '1-143.0.3650.96'
export const EDGE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0'
export const EDGE_ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold'
export const EDGE_DEFAULT_OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'
export const EDGE_DEFAULT_MIME = 'audio/mpeg'

const WINDOWS_EPOCH_OFFSET_SECS = 11_644_473_600
const GEC_WINDOW_SECS = 300
const RATE_MIN = 0.1
const RATE_MAX = 3

export type EdgeSocket = {
  send(data: string): void
  close(): void
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: ((event: unknown) => void) | null
}

export type EdgeSocketFactory = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => EdgeSocket | Promise<EdgeSocket>

export type EdgeOutput = {
  outputFormat: string
  mime: string
}

export type EdgeSsmlParams = {
  voice: string
  rate: number
  pitch: number
}

export type EdgeMessage = {
  path: string
  requestId?: string
  audio?: Buffer
}

export function edgeHandshakeHeaders(): Record<string, string> {
  return {
    'User-Agent': EDGE_USER_AGENT,
    Origin: EDGE_ORIGIN,
  }
}

export function generateSecMsGec(nowMs: number, token = EDGE_TRUSTED_CLIENT_TOKEN): string {
  const ticks = Math.floor(nowMs / 1000) + WINDOWS_EPOCH_OFFSET_SECS
  const rounded = ticks - (ticks % GEC_WINDOW_SECS)
  const windowsTicks = rounded * 10_000_000
  return createHash('sha256')
    .update(`${String(windowsTicks)}${token}`)
    .digest('hex')
    .toUpperCase()
}

export function buildEdgeSynthUrl(options: {
  nowMs: number
  connectionId?: string
  token?: string
}): string {
  const token = options.token ?? EDGE_TRUSTED_CLIENT_TOKEN
  const connectionId = options.connectionId ?? randomUUID()
  const params = new URLSearchParams({
    TrustedClientToken: token,
    'Sec-MS-GEC': generateSecMsGec(options.nowMs, token),
    'Sec-MS-GEC-Version': EDGE_SEC_MS_GEC_VERSION,
    ConnectionId: connectionId,
  })
  return `${EDGE_WSS_URL}?${params.toString()}`
}

export function buildEdgeVoicesUrl(options: { nowMs: number; token?: string }): string {
  const token = options.token ?? EDGE_TRUSTED_CLIENT_TOKEN
  const params = new URLSearchParams({
    trustedclienttoken: token,
    'Sec-MS-GEC': generateSecMsGec(options.nowMs, token),
    'Sec-MS-GEC-Version': EDGE_SEC_MS_GEC_VERSION,
  })
  return `${EDGE_VOICES_URL}?${params.toString()}`
}

export function resolveEdgeOutput(format: string | undefined): EdgeOutput {
  switch (format) {
    case 'webm':
    case 'opus':
      return { outputFormat: 'webm-24khz-16bit-mono-opus', mime: 'audio/webm' }
    case 'wav':
    case 'pcm':
      return { outputFormat: 'riff-24khz-16bit-mono-pcm', mime: 'audio/wav' }
    default:
      return { outputFormat: EDGE_DEFAULT_OUTPUT_FORMAT, mime: EDGE_DEFAULT_MIME }
  }
}

export function normalizeEdgeVoice(raw: string | undefined, fallback = EDGE_DEFAULT_VOICE): string {
  if (raw === undefined) {
    return fallback
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return fallback
  }
  for (const prefix of ['edge_', 'edge:', 'edge/'] as const) {
    if (trimmed.startsWith(prefix)) {
      const stripped = trimmed.slice(prefix.length)
      return stripped.length > 0 ? stripped : fallback
    }
  }
  return trimmed
}

export function localeFromVoice(voice: string): string {
  const match = /^([a-z]{2}-[A-Z]{2})/.exec(voice)
  return match?.[1] ?? 'zh-CN'
}

export function mapRateToSsml(rate: number): string {
  const delta = Math.round((clamp(rate, RATE_MIN, RATE_MAX) - 1) * 100)
  return `${delta >= 0 ? '+' : ''}${String(delta)}%`
}

export function mapPitchToSsml(pitch: number): string {
  const delta = Math.round((clamp(pitch, RATE_MIN, RATE_MAX) - 1) * 100)
  return `${delta >= 0 ? '+' : ''}${String(delta)}Hz`
}

export function escapeSsmlText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function buildEdgeSsml(text: string, params: EdgeSsmlParams): string {
  const locale = localeFromVoice(params.voice)
  const rate = mapRateToSsml(params.rate)
  const pitch = mapPitchToSsml(params.pitch)
  return [
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">`,
    `<voice name="${escapeSsmlText(params.voice)}">`,
    `<prosody rate="${rate}" pitch="${pitch}">`,
    escapeSsmlText(text),
    '</prosody>',
    '</voice>',
    '</speak>',
  ].join('')
}

export function buildSpeechConfigMessage(outputFormat = EDGE_DEFAULT_OUTPUT_FORMAT): string {
  const body = JSON.stringify({
    context: {
      synthesis: {
        audio: {
          metadataoptions: {
            sentenceBoundaryEnabled: 'false',
            wordBoundaryEnabled: 'false',
          },
          outputFormat,
        },
      },
    },
  })
  return `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${body}`
}

export function newEdgeRequestId(): string {
  return randomBytes(16).toString('hex')
}

export function buildSsmlMessage(requestId: string, ssml: string): string {
  return `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`
}

export function encodeEdgeAudioFrame(requestId: string, audio: Buffer): Buffer {
  const header = `X-RequestId:${requestId}\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n`
  const headerBuf = Buffer.from(header, 'utf8')
  const length = Buffer.alloc(2)
  length.writeUInt16BE(headerBuf.length)
  return Buffer.concat([length, headerBuf, audio])
}

export function parseEdgeMessage(data: unknown): EdgeMessage {
  const buf = toBuffer(data)
  if (buf.length >= 2) {
    const headerLen = buf.readUInt16BE(0)
    if (headerLen > 0 && headerLen + 2 <= buf.length) {
      const header = buf.subarray(2, 2 + headerLen).toString('utf8')
      if (header.includes('Path:audio')) {
        const requestId = readHeader(header, 'X-RequestId')
        return {
          path: 'audio',
          ...(requestId !== undefined ? { requestId } : {}),
          audio: buf.subarray(2 + headerLen),
        }
      }
    }
  }

  const delim = 'Path:audio\r\n'
  const index = buf.indexOf(delim)
  if (index !== -1) {
    const header = buf.subarray(0, index + delim.length).toString('utf8')
    const requestId = readHeader(header, 'X-RequestId')
    return {
      path: 'audio',
      ...(requestId !== undefined ? { requestId } : {}),
      audio: buf.subarray(index + delim.length),
    }
  }

  const text = buf.toString('utf8')
  const path = readPath(text) ?? 'unknown'
  const requestId = readHeader(text, 'X-RequestId')
  return {
    path,
    ...(requestId !== undefined ? { requestId } : {}),
  }
}

function toBuffer(data: unknown): Buffer {
  if (typeof data === 'string') {
    return Buffer.from(data)
  }
  if (Buffer.isBuffer(data)) {
    return data
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data)
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  }
  throw new Error('dsh-friend-tts: unsupported Edge websocket payload')
}

function readHeader(text: string, name: string): string | undefined {
  const match = new RegExp(`^${name}:(.*)$`, 'im').exec(text)
  const value = match?.[1]?.trim()
  return value !== undefined && value.length > 0 ? value : undefined
}

function readPath(text: string): string | undefined {
  const match = /^Path:(\S+)/im.exec(text)
  return match?.[1]
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 1
  }
  return Math.min(max, Math.max(min, value))
}
