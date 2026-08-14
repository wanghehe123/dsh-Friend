import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { describe, expect, it } from 'vitest'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { FriendPushEvent, ToolDefinition } from '@wishp3/dsh-friend-shared'

import { apply, createStageRoutes } from '../src/index.ts'
import {
  IDLE_PERFORMANCE,
  createPerformanceTracker,
  type PerformanceSnapshot,
} from '../src/performance-state.ts'
import { createPerformanceTools } from '../src/tools.ts'

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
    this.chunks.push(chunk)
    return true
  }

  end(chunk?: string): void {
    if (chunk !== undefined) this.chunks.push(chunk)
    this.ended = true
    this.writableEnded = true
    this.emit('close')
  }
}

function callTool(tool: ToolDefinition, args: unknown) {
  return tool.execute(args, {
    signal: new AbortController().signal,
    deferContext: () => undefined,
    concludeTurn: () => undefined,
  } as Parameters<ToolDefinition['execute']>[1])
}

function parseSseEvents(chunks: readonly string[]): FriendPushEvent[] {
  const body = chunks.join('')
  const events: FriendPushEvent[] = []
  const blocks = body.split('\n\n')
  for (const block of blocks) {
    const dataLine = block.split('\n').find((line) => line.startsWith('data: '))
    if (dataLine === undefined) continue
    events.push(JSON.parse(dataLine.slice('data: '.length)) as FriendPushEvent)
  }
  return events
}

function snapshotFields(snapshot: PerformanceSnapshot) {
  return {
    expression: snapshot.expression,
    motionGroup: snapshot.motionGroup,
    cue: snapshot.cue,
    lastAction: snapshot.lastAction,
    seq: snapshot.seq,
  }
}

describe('performance SSE snapshots are reentrant', () => {
  it('pushes a full snapshot (not a delta) on every tool call', async () => {
    const tracker = createPerformanceTracker()
    const routes: WebRoute[] = []
    const eventsRoute = (): WebRoute | undefined => routes.find((route) => route.path === '/friend/events')

    apply(
      {
        webServer: {
          register(route) {
            routes.push(route)
            return () => undefined
          },
        },
        effect(execute) {
          return execute()
        },
      },
      { role: 'host', performanceTracker: tracker },
    )

    const response = new MockResponse() as unknown as ServerResponse & MockResponse
    await eventsRoute()?.handler(
      new MockRequest('GET') as unknown as IncomingMessage,
      response,
    )

    const tools = createPerformanceTools(tracker)
    const setExpression = tools[0]
    const playMotion = tools[1]
    const playCue = tools[2]
    if (setExpression === undefined || playMotion === undefined || playCue === undefined) {
      throw new Error('expected three performance tools')
    }
    await callTool(setExpression, { expression: 'happy' })
    await callTool(playMotion, { group: 'Celebrate' })
    await callTool(playCue, { name: 'error' })

    const pushed = parseSseEvents(response.chunks).filter((event) => event.type !== 'asset-progress')
    expect(pushed).toHaveLength(3)
    expect(pushed[0]).toMatchObject({
      type: 'expr',
      payload: {
        expression: 'happy',
        motionGroup: 'Smile',
        lastAction: 'expr',
        seq: 1,
      },
    })
    expect(pushed[1]).toMatchObject({
      type: 'motion',
      payload: {
        expression: 'happy',
        motionGroup: 'Celebrate',
        lastAction: 'motion',
        seq: 2,
      },
    })
    expect(pushed[2]).toMatchObject({
      type: 'cue',
      payload: {
        expression: 'surprised',
        motionGroup: 'Error',
        cue: 'error',
        lastAction: 'cue',
        seq: 3,
      },
    })
    const last = pushed[2]?.payload as PerformanceSnapshot
    expect(snapshotFields(last)).toEqual(snapshotFields(tracker.snapshot()))
  })

  it('serves the current full snapshot on GET so an EventSource reconnect can catch up', async () => {
    const tracker = createPerformanceTracker()
    tracker.setExpression('sad')
    tracker.playCue('thinking')

    const route = createStageRoutes({ performanceTracker: tracker }).find(
      (item) => item.path === '/friend/stage/performance',
    )
    expect(route).toMatchObject({ kind: 'exact', path: '/friend/stage/performance' })

    const response = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      body: '',
      setHeader(header: string, value: string) {
        this.headers[header.toLowerCase()] = value
      },
      end(body = '') {
        this.body = String(body)
      },
    }
    await route?.handler(
      { method: 'GET', url: '/friend/stage/performance' } as IncomingMessage,
      response as unknown as ServerResponse,
    )

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body) as PerformanceSnapshot
    expect(body).toEqual(tracker.snapshot())
    expect(body.expression).toBe('neutral')
    expect(body.motionGroup).toBe('Thinking')
    expect(body.cue).toBe('thinking')
    expect(body.lastAction).toBe('cue')
    expect(body.seq).toBe(2)
  })

  it('starts from a complete idle snapshot so a reconnect before any tool call is defined', async () => {
    const route = createStageRoutes().find((item) => item.path === '/friend/stage/performance')
    const response = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      body: '',
      setHeader(header: string, value: string) {
        this.headers[header.toLowerCase()] = value
      },
      end(body = '') {
        this.body = String(body)
      },
    }
    await route?.handler(
      { method: 'GET', url: '/friend/stage/performance' } as IncomingMessage,
      response as unknown as ServerResponse,
    )
    expect(JSON.parse(response.body)).toEqual(IDLE_PERFORMANCE)
  })
})
