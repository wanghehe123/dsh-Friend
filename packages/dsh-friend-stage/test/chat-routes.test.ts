import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { describe, expect, it, vi } from 'vitest'

import { createChatRoutes } from '../src/chat-routes.ts'
import { createChatTracker } from '../src/chat-state.ts'

class BodyRequest extends EventEmitter {
  method: string
  headers: Record<string, string> = { 'content-type': 'application/json' }
  url = '/friend/stage/chat'
  constructor(method: string, private readonly payload: string) {
    super()
    this.method = method
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    yield Buffer.from(this.payload)
  }
}

function response() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value
    },
    end(body = '') {
      this.body = String(body)
    },
  }
}

describe('companion chat route', () => {
  it('GET returns a reentrant idle snapshot', async () => {
    const chat = createChatTracker()
    const route = createChatRoutes({ chat })[0]
    const res = response()
    await route?.handler(
      { method: 'GET', url: '/friend/stage/chat' } as IncomingMessage,
      res as unknown as ServerResponse,
    )
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ status: 'idle', seq: 0, typing: false })
  })

  it('POST calls the injected send seam once and records a full snapshot', async () => {
    const chat = createChatTracker()
    const send = vi.fn(async () => ({ sessionId: 'friend-companion-1', sent: true }))
    const route = createChatRoutes({ chat, send })[0]
    const res = response()
    await route?.handler(
      new BodyRequest('POST', JSON.stringify({ text: '你好' })) as unknown as IncomingMessage,
      res as unknown as ServerResponse,
    )
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('你好')
    const body = JSON.parse(res.body) as { sent: boolean; sessionId: string; status: string }
    expect(body.sent).toBe(true)
    expect(body.sessionId).toBe('friend-companion-1')
    expect(body.status).toBe('typing')
    expect(chat.snapshot()).toMatchObject({ userText: '你好', sent: true, seq: 2 })
  })

  it('POST surfaces the send-seam error on 502', async () => {
    const chat = createChatTracker()
    const send = vi.fn(async () => ({
      sessionId: '',
      sent: false,
      error: 'preset "friend-companion": 1 row(s) did not activate',
    }))
    const route = createChatRoutes({ chat, send })[0]
    const res = response()
    await route?.handler(
      new BodyRequest('POST', JSON.stringify({ text: '你好' })) as unknown as IncomingMessage,
      res as unknown as ServerResponse,
    )
    expect(res.statusCode).toBe(502)
    expect(JSON.parse(res.body)).toMatchObject({
      ok: false,
      sent: false,
      error: 'preset "friend-companion": 1 row(s) did not activate',
    })
  })

  it('returns 503 when persona send is not wired', async () => {
    const route = createChatRoutes({ chat: createChatTracker() })[0]
    const res = response()
    await route?.handler(
      new BodyRequest('POST', JSON.stringify({ text: 'hi' })) as unknown as IncomingMessage,
      res as unknown as ServerResponse,
    )
    expect(res.statusCode).toBe(503)
  })
})
