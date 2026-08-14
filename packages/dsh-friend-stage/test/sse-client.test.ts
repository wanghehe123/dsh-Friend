import { describe, expect, it } from 'vitest'

import { createSseClient, type SseLike } from '../src/sse-client.ts'

class FakeSource implements SseLike {
  readyState: 0 | 1 | 2 = 0
  readonly listeners = new Map<string, Array<(event: { data: string }) => void>>()
  closed = false

  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  close(): void {
    this.closed = true
    this.readyState = 2
  }

  emit(type: string, data = ''): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data })
  }
}

describe('SSE reconnect and offline badge', () => {
  it('marks connected on open and disconnected on a CLOSED error, then recreates', () => {
    const sources: FakeSource[] = []
    const statuses: string[] = []
    const scheduled: Array<() => void> = []

    const client = createSseClient({
      url: '/friend/events',
      factory: () => {
        const source = new FakeSource()
        sources.push(source)
        return source
      },
      events: ['expr'],
      onStatus: (status) => {
        statuses.push(status)
      },
      onEvent: () => undefined,
      backoffMs: [10],
      schedule: (callback) => {
        scheduled.push(callback)
        return scheduled.length
      },
      cancel: () => undefined,
    })

    sources[0]?.emit('open')
    expect(client.status()).toBe('connected')
    sources[0]!.readyState = 2
    sources[0]?.emit('error')
    expect(client.status()).toBe('disconnected')
    expect(scheduled).toHaveLength(1)
    scheduled[0]?.()
    expect(sources).toHaveLength(2)
    client.close()
    expect(statuses).toEqual(['connected', 'disconnected'])
  })

  it('stops reconnecting while disabled and connects again when re-enabled', () => {
    const sources: FakeSource[] = []
    const scheduled: Array<() => void> = []
    const client = createSseClient({
      url: '/friend/events',
      factory: () => {
        const source = new FakeSource()
        sources.push(source)
        return source
      },
      onStatus: () => undefined,
      onEvent: () => undefined,
      backoffMs: [10],
      schedule: (callback) => {
        scheduled.push(callback)
        return scheduled.length
      },
      cancel: () => undefined,
    })

    expect(sources).toHaveLength(1)
    client.setEnabled(false)
    expect(sources[0]?.closed).toBe(true)
    sources[0]!.readyState = 2
    sources[0]?.emit('error')
    expect(scheduled).toHaveLength(0)

    client.setEnabled(true)
    expect(sources).toHaveLength(2)
    client.close()
  })
})
