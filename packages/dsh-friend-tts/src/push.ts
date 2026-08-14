/**
 * TTS-owned SSE hub at `GET /friend/tts/events`.
 *
 * Do not call shared `pushToClient` — that registers `/friend/events`, which
 * stage already owns. This sibling path keeps the downlink self-contained.
 * Inject {@link FriendTtsReadySink} into `apply()` to reuse another channel
 * later without a second `/friend/events` registrant.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import { registerRoute, type FriendRouteContext } from '@wishp3/dsh-friend-shared'

import { FRIEND_TTS_EVENTS_PATH } from './paths.ts'
import type { FriendTtsReadyEvent, FriendTtsReadySink } from './playback-events.ts'

export const FRIEND_TTS_SSE_HEARTBEAT_MS = 20_000

export type FriendTtsPushHandle = FriendTtsReadySink & {
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

function formatSseEvent(event: FriendTtsReadyEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export function createFriendTtsEventsHub(ctx: FriendRouteContext): FriendTtsPushHandle {
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
    }, FRIEND_TTS_SSE_HEARTBEAT_MS)
    heartbeat.unref?.()
  }

  const disposeRoute = registerRoute(ctx, {
    kind: 'exact',
    path: FRIEND_TTS_EVENTS_PATH,
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

  ctx.effect(() => shutdown, 'dsh-friend-tts: sse connections /friend/tts/events')

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

export function resolveTtsReadySink(
  ctx: FriendRouteContext | undefined,
  injected: FriendTtsReadySink | undefined,
): { sink: FriendTtsReadySink; dispose: () => void } {
  if (injected !== undefined) {
    return {
      sink: injected,
      dispose() {
        void injected.dispose?.()
      },
    }
  }
  if (ctx === undefined) {
    return { sink: { push() {} }, dispose() {} }
  }
  const hub = createFriendTtsEventsHub(ctx)
  return {
    sink: hub,
    dispose() {
      void hub.dispose()
    },
  }
}
