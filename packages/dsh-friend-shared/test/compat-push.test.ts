import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

import {
  FRIEND_EVENTS_PATH,
  FRIEND_SSE_HEARTBEAT_MS,
  pushToClient,
  type FriendRouteContext,
} from '../src/dsh-compat.ts'

class MockRequest extends EventEmitter {
  method: string | undefined
  constructor(method: string | undefined) {
    super()
    this.method = method
  }
}

class MockResponse extends EventEmitter {
  statusCode = 0
  headers: Record<string, string> = {}
  chunks: string[] = []
  ended = false
  writableEnded = false

  setHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value
  }

  flushHeaders(): void {}

  write(chunk: string): boolean {
    if (this.writableEnded) {
      throw new Error('write after end')
    }
    this.chunks.push(chunk)
    return true
  }

  end(chunk?: string): void {
    if (chunk !== undefined) {
      this.chunks.push(chunk)
    }
    this.ended = true
    this.writableEnded = true
    this.emit('close')
  }
}

function mockPushContext() {
  let route: WebRoute | undefined
  const disposeRoute = vi.fn()
  const register = vi.fn<(next: WebRoute) => () => void>((next) => {
    route = next
    return disposeRoute
  })
  const effect = vi.fn<FriendRouteContext['effect']>((callback) => callback())
  const ctx = {
    effect,
    webServer: { register },
  } satisfies FriendRouteContext
  return {
    ctx,
    effect,
    register,
    disposeRoute,
    getRoute: () => route,
  }
}

describe('pushToClient', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('registers GET /friend/events as an exact route and writes SSE headers', async () => {
    const { ctx, register, getRoute } = mockPushContext()
    const handle = pushToClient(ctx)

    expect(register).toHaveBeenCalledOnce()
    const route = getRoute()
    expect(route).toMatchObject({ kind: 'exact', path: FRIEND_EVENTS_PATH })

    const request = new MockRequest('GET') as unknown as IncomingMessage
    const response = new MockResponse() as unknown as ServerResponse & MockResponse
    await route?.handler(request, response)

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/event-stream')
    expect(response.headers['cache-control']).toBe('no-cache')
    expect(response.headers['connection']).toBe('keep-alive')
    expect(response.chunks[0]).toBe(': connected\n\n')

    handle.dispose()
  })

  it('rejects non-GET methods with 405', async () => {
    const { ctx, getRoute } = mockPushContext()
    const handle = pushToClient(ctx)
    const route = getRoute()

    const request = new MockRequest('POST') as unknown as IncomingMessage
    const response = new MockResponse() as unknown as ServerResponse & MockResponse
    await route?.handler(request, response)

    expect(response.statusCode).toBe(405)
    expect(response.headers['allow']).toBe('GET')
    expect(response.ended).toBe(true)
    expect(response.headers['content-type']).toBeUndefined()

    handle.dispose()
  })

  it('broadcasts push() to every subscriber', async () => {
    const { ctx, getRoute } = mockPushContext()
    const handle = pushToClient(ctx)
    const route = getRoute()

    const first = new MockResponse() as unknown as ServerResponse & MockResponse
    const second = new MockResponse() as unknown as ServerResponse & MockResponse
    await route?.handler(new MockRequest('GET') as unknown as IncomingMessage, first)
    await route?.handler(new MockRequest('GET') as unknown as IncomingMessage, second)

    handle.push({ type: 'expr', payload: { name: 'smile' } })

    const frame = 'event: expr\ndata: {"type":"expr","payload":{"name":"smile"}}\n\n'
    expect(first.chunks).toContain(frame)
    expect(second.chunks).toContain(frame)

    handle.dispose()
  })

  it('writes a comment heartbeat while subscribers are connected', async () => {
    vi.useFakeTimers()
    const { ctx, getRoute } = mockPushContext()
    const handle = pushToClient(ctx)
    const response = new MockResponse() as unknown as ServerResponse & MockResponse
    await getRoute()?.handler(new MockRequest('GET') as unknown as IncomingMessage, response)

    const before = response.chunks.length
    await vi.advanceTimersByTimeAsync(FRIEND_SSE_HEARTBEAT_MS)
    expect(response.chunks.slice(before)).toEqual([': ping\n\n'])

    handle.dispose()
  })

  it('dispose ends every open connection and unregisters the route', async () => {
    const { ctx, getRoute, disposeRoute } = mockPushContext()
    const handle = pushToClient(ctx)
    const first = new MockResponse() as unknown as ServerResponse & MockResponse
    const second = new MockResponse() as unknown as ServerResponse & MockResponse
    await getRoute()?.handler(new MockRequest('GET') as unknown as IncomingMessage, first)
    await getRoute()?.handler(new MockRequest('GET') as unknown as IncomingMessage, second)

    handle.dispose()

    expect(first.ended).toBe(true)
    expect(second.ended).toBe(true)
    expect(disposeRoute).toHaveBeenCalledOnce()
  })
})
