/**
 * `GET /friend/tts/audio/<id>` — prefix route, id parsed in-handler.
 * rc.6 WebRoute has no `:param`. dsh does not filter by method.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

import { FRIEND_TTS_CACHE_TTL_MS, isTtsCacheId, type FriendTtsCachedAudio } from './cache.ts'
import { FRIEND_TTS_AUDIO_PATH } from './paths.ts'

export type TtsAudioLookup = (id: string) => Promise<FriendTtsCachedAudio | undefined> | FriendTtsCachedAudio | undefined

export type CreateTtsAudioRouteOptions = {
  getAudio: TtsAudioLookup
  ttlSeconds?: number
}

export function createTtsAudioRoute(options: CreateTtsAudioRouteOptions): WebRoute {
  const ttlSeconds = options.ttlSeconds ?? Math.floor(FRIEND_TTS_CACHE_TTL_MS / 1000)
  return {
    kind: 'prefix',
    path: FRIEND_TTS_AUDIO_PATH,
    async handler(request, response) {
      if (!isGet(request)) {
        writeText(response, 'Method Not Allowed', 405)
        return
      }

      const rawUrl = request.url ?? '/'
      const decodedPath = decodeRequestPath(rawUrl)
      if (decodedPath === undefined) {
        writeText(response, 'Forbidden', 403)
        return
      }

      const slashPath = decodedPath.replace(/\\/gu, '/')
      const rawPath = (rawUrl.split('?')[0] ?? '').replace(/\\/gu, '/')
      if (pathHasTraversal(slashPath) || pathHasTraversal(rawPath)) {
        writeText(response, 'Forbidden', 403)
        return
      }

      if (!slashPath.startsWith(FRIEND_TTS_AUDIO_PATH)) {
        writeText(response, 'Not Found', 404)
        return
      }

      const remainder = slashPath.slice(FRIEND_TTS_AUDIO_PATH.length).replace(/^\/+/u, '')
      if (remainder.length === 0 || remainder.includes('/') || !isTtsCacheId(remainder)) {
        writeText(response, 'Not Found', 404)
        return
      }

      const entry = await options.getAudio(remainder)
      if (entry === undefined) {
        writeText(response, 'Not Found', 404)
        return
      }

      response.statusCode = 200
      response.setHeader('content-type', entry.mime)
      response.setHeader('cache-control', `private, max-age=${String(ttlSeconds)}`)
      response.setHeader('content-length', String(entry.audio.byteLength))
      response.end(entry.audio)
    },
  }
}

export function createTtsRoutes(options: CreateTtsAudioRouteOptions): WebRoute[] {
  return [createTtsAudioRoute(options)]
}

export function decodeRequestPath(rawUrl: string): string | undefined {
  const rawPath = rawUrl.split('?')[0] ?? '/'
  let current = rawPath
  for (let i = 0; i < 4; i += 1) {
    try {
      const next = decodeURIComponent(current)
      if (next === current) {
        break
      }
      current = next
    } catch {
      return undefined
    }
  }
  return current
}

export function pathHasTraversal(path: string): boolean {
  return path.replace(/\\/gu, '/').split('/').includes('..')
}

function isGet(request: IncomingMessage): boolean {
  return request.method === undefined || request.method.toUpperCase() === 'GET'
}

function writeText(response: ServerResponse, body: string, statusCode: number): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(body)
}
