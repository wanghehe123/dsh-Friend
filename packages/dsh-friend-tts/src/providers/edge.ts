/**
 * Zero-key Edge Read Aloud provider. Default voice: `zh-CN-XiaoxiaoNeural`.
 *
 * Network / timeout failures throw so the W-M2-1 router can degrade.
 * This module does not surface UI errors.
 */

import { EDGE_BUILTIN_VOICES } from '../voices.ts'
import {
  type FriendTtsProvider,
  type FriendTtsSynthesizeOpts,
  type FriendTtsVoice,
  type FriendTtsVoiceGender,
} from '../seam.ts'
import {
  EDGE_DEFAULT_VOICE,
  EDGE_PROVIDER_ID,
  EDGE_USER_AGENT,
  buildEdgeSsml,
  buildEdgeSynthUrl,
  buildEdgeVoicesUrl,
  buildSpeechConfigMessage,
  buildSsmlMessage,
  edgeHandshakeHeaders,
  newEdgeRequestId,
  normalizeEdgeVoice,
  parseEdgeMessage,
  resolveEdgeOutput,
  type EdgeSocket,
  type EdgeSocketFactory,
} from './edge-protocol.ts'

export {
  EDGE_DEFAULT_MIME,
  EDGE_DEFAULT_OUTPUT_FORMAT,
  EDGE_DEFAULT_VOICE,
  EDGE_PROVIDER_ID,
  EDGE_TRUSTED_CLIENT_TOKEN,
  EDGE_USER_AGENT,
  EDGE_WSS_URL,
  buildEdgeSsml,
  buildEdgeSynthUrl,
  buildEdgeVoicesUrl,
  buildSpeechConfigMessage,
  buildSsmlMessage,
  encodeEdgeAudioFrame,
  generateSecMsGec,
  mapPitchToSsml,
  mapRateToSsml,
  normalizeEdgeVoice,
  parseEdgeMessage,
  resolveEdgeOutput,
} from './edge-protocol.ts'

export const EDGE_SYNTH_TIMEOUT_MS = 15_000

export { EDGE_BUILTIN_VOICES } from '../voices.ts'

export type EdgeTtsProviderOptions = {
  voice?: string
  timeoutMs?: number
  connect?: EdgeSocketFactory
  fetchVoices?: typeof fetch
  now?: () => number
  requestId?: () => string
}

export function createEdgeTtsProvider(options: EdgeTtsProviderOptions = {}): FriendTtsProvider {
  const defaultVoice = normalizeEdgeVoice(options.voice)
  const timeoutMs = options.timeoutMs ?? EDGE_SYNTH_TIMEOUT_MS
  const now = options.now ?? Date.now
  const requestId = options.requestId ?? newEdgeRequestId
  const fetchVoices = options.fetchVoices ?? fetch
  const connect = options.connect ?? defaultConnect

  return {
    id: EDGE_PROVIDER_ID,

    async listVoices() {
      try {
        const url = buildEdgeVoicesUrl({ nowMs: now() })
        const response = await fetchVoices(url, {
          headers: { 'User-Agent': EDGE_USER_AGENT },
        })
        if (!response.ok) {
          throw new Error(`Edge voices HTTP ${String(response.status)}`)
        }
        const listed = mapVoiceList(await response.json())
        return listed.length > 0 ? listed : EDGE_BUILTIN_VOICES
      } catch {
        return EDGE_BUILTIN_VOICES
      }
    },

    async synthesize(text, opts) {
      const trimmed = text.trim()
      if (trimmed.length === 0) {
        throw new Error('Edge TTS refused empty text')
      }

      const voice = normalizeEdgeVoice(opts?.voice, defaultVoice)
      const rate = opts?.rate ?? 1
      const pitch = opts?.pitch ?? 1
      const output = resolveEdgeOutput(opts?.format)
      const ssml = buildEdgeSsml(trimmed, { voice, rate, pitch })
      const id = requestId()
      const url = buildEdgeSynthUrl({ nowMs: now() })
      const socket = await connect(url, edgeHandshakeHeaders())

      try {
        await waitForOpen(socket, timeoutMs)
        const audioPromise = collectAudio(socket, timeoutMs)
        socket.send(buildSpeechConfigMessage(output.outputFormat))
        socket.send(buildSsmlMessage(id, ssml))
        const audio = await audioPromise
        return { audio, mime: output.mime }
      } finally {
        socket.close()
      }
    },
  }
}

export function createDefaultEdgeProvider(): FriendTtsProvider {
  return createEdgeTtsProvider()
}

async function defaultConnect(url: string, headers: Readonly<Record<string, string>>): Promise<EdgeSocket> {
  const { openEdgeWebSocket } = await import('./edge-socket.ts')
  return openEdgeWebSocket(url, headers)
}

function waitForOpen(socket: EdgeSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (error !== undefined) {
        reject(error)
        return
      }
      resolve()
    }

    const timer = setTimeout(() => {
      finish(new Error('Edge TTS connect timed out'))
    }, timeoutMs)
    timer.unref?.()

    socket.onopen = () => {
      finish()
    }
    socket.onerror = () => {
      finish(new Error('Edge TTS connect failed'))
    }
    socket.onclose = () => {
      finish(new Error('Edge TTS connection closed'))
    }
  })
}

function collectAudio(socket: EdgeSocket, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false

    const finish = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (error !== undefined) {
        reject(error)
        return
      }
      resolve(Buffer.concat(chunks))
    }

    const timer = setTimeout(() => {
      finish(new Error('Edge TTS timed out'))
    }, timeoutMs)
    timer.unref?.()

    socket.onmessage = (event) => {
      let message
      try {
        message = parseEdgeMessage(event.data)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
        return
      }
      if (message.audio !== undefined && message.audio.length > 0) {
        chunks.push(message.audio)
      }
      if (message.path === 'turn.end') {
        if (chunks.length === 0) {
          finish(new Error('Edge TTS returned no audio'))
          return
        }
        finish()
      }
    }
    socket.onerror = () => {
      finish(new Error('Edge TTS WebSocket error'))
    }
    socket.onclose = () => {
      finish(new Error('Edge TTS connection closed'))
    }
  })
}

function mapVoiceList(raw: unknown): FriendTtsVoice[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const voices: FriendTtsVoice[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') {
      continue
    }
    const record = entry as Record<string, unknown>
    const id = asNonEmptyString(record.ShortName) ?? asNonEmptyString(record.shortName)
    if (id === undefined) {
      continue
    }
    const name = asNonEmptyString(record.FriendlyName)
      ?? asNonEmptyString(record.friendlyName)
      ?? id
    const language = asNonEmptyString(record.Locale) ?? asNonEmptyString(record.locale) ?? 'und'
    const gender = parseGender(asNonEmptyString(record.Gender) ?? asNonEmptyString(record.gender))
    voices.push({
      id,
      name,
      language,
      ...(gender !== undefined ? { gender } : {}),
    })
  }
  return voices
}

function parseGender(raw: string | undefined): FriendTtsVoiceGender | undefined {
  if (raw === undefined) {
    return undefined
  }
  switch (raw.toLowerCase()) {
    case 'male':
      return 'male'
    case 'female':
      return 'female'
    case 'neutral':
      return 'neutral'
    default:
      return undefined
  }
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export type { EdgeSocket, EdgeSocketFactory, FriendTtsSynthesizeOpts }
