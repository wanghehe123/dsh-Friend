/**
 * `POST /friend/tts/preview` — LLM-free 试听. Always synthesizes (autoSpeak
 * override true). Returns a client-safe `tts-ready` payload, never audio
 * bytes or API keys.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

import { FRIEND_TTS_PREVIEW_PATH } from './paths.ts'
import type { FriendTtsReadySink } from './playback-events.ts'
import { FRIEND_TTS_PREVIEW_SENTENCE } from './preview-sentence.ts'
import { toTtsReadyEvent } from './ready-event.ts'
import type { FriendTtsService } from './service.ts'

export type CreateTtsPreviewRouteOptions = {
  speak: FriendTtsService['speak']
  sink: FriendTtsReadySink
}

export function createTtsPreviewRoute(options: CreateTtsPreviewRouteOptions): WebRoute {
  return {
    kind: 'exact',
    path: FRIEND_TTS_PREVIEW_PATH,
    async handler(request, response) {
      if (!isPost(request)) {
        writeText(response, 'Method Not Allowed', 405)
        return
      }

      let body: unknown
      try {
        body = await readJson(request)
      } catch {
        writeText(response, 'Bad Request', 400)
        return
      }

      const opts = readPreviewOpts(body)
      const text = opts.text
      const result = await options.speak(text, {
        autoSpeak: true,
        ...(opts.voice !== undefined ? { voice: opts.voice } : {}),
        ...(opts.rate !== undefined ? { rate: opts.rate } : {}),
        ...(opts.pitch !== undefined ? { pitch: opts.pitch } : {}),
        ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
      })
      if (
        opts.provider !== undefined
        && opts.provider !== 'browser'
        && result.kind === 'browser-fallback'
      ) {
        writeJson(response, {
          ok: false,
          error: result.reason,
          requestedProvider: opts.provider,
          failedProviders: result.failedProviders ?? [],
        }, 422)
        return
      }
      const event = toTtsReadyEvent(result, 'preview')
      options.sink.push(event)
      writeJson(response, event.payload)
    },
  }
}

type PreviewOpts = {
  text: string
  voice?: string
  rate?: number
  pitch?: number
  provider?: string
}

function readPreviewOpts(body: unknown): PreviewOpts {
  if (body === null || typeof body !== 'object') {
    return { text: FRIEND_TTS_PREVIEW_SENTENCE }
  }
  const record = body as Record<string, unknown>
  const text = asNonEmptyString(record.text) ?? FRIEND_TTS_PREVIEW_SENTENCE
  const opts: PreviewOpts = { text }
  const voice = asNonEmptyString(record.voice)
  if (voice !== undefined) opts.voice = voice
  const rate = asFiniteNumber(record.rate)
  if (rate !== undefined) opts.rate = rate
  const pitch = asFiniteNumber(record.pitch)
  if (pitch !== undefined) opts.pitch = pitch
  const provider = asNonEmptyString(record.provider)
  if (provider !== undefined) opts.provider = provider
  return opts
}

function isPost(request: IncomingMessage): boolean {
  return (request.method ?? '').toUpperCase() === 'POST'
}

async function readJson(request: IncomingMessage, maxBytes = 8_192): Promise<unknown> {
  let body = ''
  for await (const chunk of request) {
    body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    if (body.length > maxBytes) {
      throw new Error('request body is too large')
    }
  }
  if (body.trim().length === 0) {
    return {}
  }
  return JSON.parse(body) as unknown
}

function writeJson(response: ServerResponse, body: object, statusCode = 200): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}

function writeText(response: ServerResponse, body: string, statusCode: number): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(body)
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
