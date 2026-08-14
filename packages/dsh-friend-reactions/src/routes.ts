import type { IncomingMessage, ServerResponse } from 'node:http'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { registerRoute, type FriendRouteContext } from '@wishp3/dsh-friend-shared'

import type { ReactEngine } from './react.ts'
import type { ReactionLevel, ReactionSettings } from './settings.ts'
import { renderReactionsPage } from './ui-page.ts'

export type ReactionRouteDeps = {
  engine: ReactEngine
  settings: () => ReactionSettings
  setLevel?: (level: ReactionLevel) => void
}

export type ReactionRouteHandle = {
  routes: readonly WebRoute[]
  push: (snapshot: object) => void
}

export function createReactionRoutes(deps: ReactionRouteDeps): ReactionRouteHandle {
  const subscribers = new Set<ServerResponse>()

  const push = (snapshot: object): void => {
    const frame = `event: reaction\ndata: ${JSON.stringify({ type: 'reaction', payload: snapshot })}\n\n`
    for (const response of [...subscribers]) {
      try {
        if (response.writableEnded) {
          subscribers.delete(response)
          continue
        }
        response.write(frame)
      } catch {
        subscribers.delete(response)
      }
    }
  }

  const routes: WebRoute[] = [
    {
      kind: 'exact',
      path: '/friend/reactions',
      async handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        writeHtml(response, renderReactionsPage())
      },
    },
    {
      kind: 'exact',
      path: '/friend/reactions/latest',
      async handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        writeJson(response, deps.engine.last() ?? { empty: true })
      },
    },
    {
      kind: 'exact',
      path: '/friend/reactions/events',
      handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        response.statusCode = 200
        response.setHeader('Content-Type', 'text/event-stream')
        response.setHeader('Cache-Control', 'no-cache')
        response.setHeader('Connection', 'keep-alive')
        response.flushHeaders?.()
        const last = deps.engine.last()
        if (last !== undefined) {
          response.write(`event: reaction\ndata: ${JSON.stringify({ type: 'reaction', payload: last })}\n\n`)
        } else {
          response.write(': connected\n\n')
        }
        subscribers.add(response)
        const onClose = (): void => {
          subscribers.delete(response)
        }
        request.on('close', onClose)
        response.on('close', onClose)
      },
    },
    {
      kind: 'exact',
      path: '/friend/reactions/level',
      async handler(request, response) {
        if (request.method !== 'POST') {
          return writeText(response, 'Method Not Allowed', 405)
        }
        try {
          const body = await readJson(request) as { level?: unknown }
          if (body.level !== 'action' && body.level !== 'bubble' && body.level !== 'voice') {
            return writeJson(response, { ok: false, error: 'invalid level' }, 400)
          }
          deps.setLevel?.(body.level)
          writeJson(response, { ok: true, level: body.level })
        } catch (error) {
          writeJson(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
        }
      },
    },
  ]

  return { routes, push }
}

export function registerReactionRoutes(ctx: FriendRouteContext, deps: ReactionRouteDeps): ReactionRouteHandle {
  const handle = createReactionRoutes(deps)
  for (const route of handle.routes) {
    registerRoute(ctx, route)
  }
  return handle
}

function isGet(request: IncomingMessage): boolean {
  return request.method === undefined || request.method === 'GET'
}

function writeHtml(response: ServerResponse, body: string): void {
  response.statusCode = 200
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(body)
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
  response.end(body)
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of request) {
    body += String(chunk)
    if (body.length > 8_192) {
      throw new Error('request body is too large')
    }
  }
  return body.trim().length === 0 ? {} : JSON.parse(body) as unknown
}
