import type { IncomingMessage, ServerResponse } from 'node:http'

import { FRIEND_EVENTS_PATH, type FriendPushEvent } from './events.ts'
import { registerRoute, type FriendRouteContext } from './route.ts'

/** Heartbeat comment interval. Official guidance is 15–30s to keep proxies from cutting idle SSE. */
export const FRIEND_SSE_HEARTBEAT_MS = 20_000

export interface FriendPushHandle {
  /** Broadcast to every current SSE subscriber. Dropped when nobody is listening. */
  push(event: FriendPushEvent): void
  /** Close every open SSE response and unregister `/friend/events`. */
  dispose: () => void | Promise<void>
}

function isGet(request: IncomingMessage): boolean {
  return (request.method ?? '').toUpperCase() === 'GET'
}

function writeSse(response: ServerResponse, chunk: string): boolean {
  try {
    if (response.writableEnded) {
      return false
    }
    return response.write(chunk) !== false
  } catch {
    return false
  }
}

function formatSseEvent(event: FriendPushEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

/**
 * Open a plugin-owned SSE downlink at `GET /friend/events`.
 *
 * Official host→client seams (`/api/events.mux`, `/api/events.host`, and
 * `host/remote-event` via `API_REMOTE_FORWARDED_EVENTS` in
 * `@deepseek-ai/dsh-api-remotes`) are closed whitelists — a plugin cannot
 * add `friend/expr` and must not stuff private frames into MuxFrame.
 *
 * Implementation: `registerRoute` (`@deepseek-ai/dsh-host-webserver`) with
 * `kind: 'exact'`. `WebRoute.handler` is documented to hold the response
 * open for SSE. Real shape measured on rc.6: `WebServer.register#1` (see
 * `./route.ts`); this module adds no extra dsh service call.
 *
 * Replacement: if a later Harness release adds an extensible plugin
 * downlink, keep {@link FriendPushEvent} and swap only this transport.
 *
 * Progress events (`asset-progress`) must be reentrant snapshots, not
 * deltas — `EventSource` reconnects automatically.
 */
export function pushToClient(ctx: FriendRouteContext): FriendPushHandle {
  const connections = new Set<ServerResponse>()
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let disposed = false

  const stopHeartbeat = (): void => {
    if (heartbeat === undefined) {
      return
    }
    clearInterval(heartbeat)
    heartbeat = undefined
  }

  const endAll = (): void => {
    for (const response of [...connections]) {
      connections.delete(response)
      try {
        response.end()
      } catch {
        // already closed
      }
    }
  }

  const shutdown = (): void => {
    if (disposed) {
      return
    }
    disposed = true
    stopHeartbeat()
    endAll()
  }

  const ensureHeartbeat = (): void => {
    if (heartbeat !== undefined || disposed) {
      return
    }
    heartbeat = setInterval(() => {
      for (const response of [...connections]) {
        if (!writeSse(response, ': ping\n\n')) {
          connections.delete(response)
          try {
            response.end()
          } catch {
            // ignore
          }
        }
      }
      if (connections.size === 0) {
        stopHeartbeat()
      }
    }, FRIEND_SSE_HEARTBEAT_MS)
    heartbeat.unref?.()
  }

  const disposeRoute = registerRoute(ctx, {
    kind: 'exact',
    path: FRIEND_EVENTS_PATH,
    handler(request, response) {
      if (!isGet(request)) {
        response.statusCode = 405
        response.setHeader('Allow', 'GET')
        response.end()
        return
      }

      response.statusCode = 200
      response.setHeader('Content-Type', 'text/event-stream')
      response.setHeader('Cache-Control', 'no-cache')
      response.setHeader('Connection', 'keep-alive')
      response.flushHeaders()
      writeSse(response, ': connected\n\n')
      connections.add(response)
      ensureHeartbeat()

      const onClose = (): void => {
        connections.delete(response)
        if (connections.size === 0) {
          stopHeartbeat()
        }
      }
      request.on('close', onClose)
      response.on('close', onClose)
    },
  })

  ctx.effect(() => shutdown, 'dsh-friend: sse connections /friend/events')

  return {
    push(event) {
      if (disposed) {
        return
      }
      const frame = formatSseEvent(event)
      for (const response of [...connections]) {
        if (!writeSse(response, frame)) {
          connections.delete(response)
        }
      }
    },
    dispose() {
      shutdown()
      return disposeRoute()
    },
  }
}
