/**
 * `POST /friend/asr/transcribe` — exact route, method checked in-handler.
 * rc.6 WebRoute has no method filter.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

import { FRIEND_ASR_TRANSCRIBE_PATH } from './paths.ts'
import { ASR_TRANSCRIBE_MAX_BYTES, type AsrTranscribeProxy } from './proxy.ts'

export type CreateAsrTranscribeRouteOptions = {
  proxy: AsrTranscribeProxy
  getLanguage?: () => string | undefined
}

export function createAsrTranscribeRoute(options: CreateAsrTranscribeRouteOptions): WebRoute {
  return {
    kind: 'exact',
    path: FRIEND_ASR_TRANSCRIBE_PATH,
    async handler(request, response) {
      if (!isPost(request)) {
        writeText(response, 'Method Not Allowed', 405)
        return
      }

      try {
        const audio = await readRawBody(request, ASR_TRANSCRIBE_MAX_BYTES)
        const mime = contentTypeOf(request) ?? 'audio/webm'
        const language = options.getLanguage?.()
        const result = await options.proxy.transcribe({
          audio,
          mime,
          ...(language !== undefined ? { language } : {}),
        })
        writeJson(response, { text: result.text }, 200)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const status = /too large/u.test(message) ? 413 : /missing|empty/u.test(message) ? 400 : 502
        writeJson(response, { error: message }, status)
      }
    },
  }
}

export function createAsrRoutes(options: CreateAsrTranscribeRouteOptions): WebRoute[] {
  return [createAsrTranscribeRoute(options)]
}

function isPost(request: IncomingMessage): boolean {
  return (request.method ?? '').toUpperCase() === 'POST'
}

function contentTypeOf(request: IncomingMessage): string | undefined {
  const raw = request.headers['content-type']
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return undefined
  }
  return raw.split(';')[0]?.trim()
}

async function readRawBody(request: IncomingMessage, maxBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > maxBytes) {
      throw new Error('asr-endpoint: audio too large')
    }
    chunks.push(buffer)
  }
  return new Uint8Array(Buffer.concat(chunks))
}

function writeText(response: ServerResponse, body: string, statusCode: number): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(body)
}

function writeJson(response: ServerResponse, body: object, statusCode: number): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}
