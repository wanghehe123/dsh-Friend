import { describe, expect, it, vi } from 'vitest'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { createFriendSettingsInstallProbe, FRIEND_EVENTS_PATH, FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared'

import { apply, inject, name } from '../src/index.ts'
import { createChatTracker } from '../src/chat-state.ts'
import { createPerformanceTracker } from '../src/performance-state.ts'
import type { SessionEventSource } from '@wish233/dsh-friend-persona'

describe('stage apply()', () => {
  it('registers friend-stage on the production host path', () => {
    const probe = createFriendSettingsInstallProbe()
    apply({
      ...probe,
      webServer: {
        register() {
          return () => undefined
        },
      },
      effect(execute) {
        return execute()
      },
    })
    expect(probe.registered.map((item) => item.ns)).toEqual([FRIEND_SETTINGS_NAMESPACES.stage])
  })

  it('logs the scoped plugin id, registers SSE, and reads FPS from the stage namespace', async () => {
    const routes: WebRoute[] = []
    const settingsGet = vi.fn((namespace: string) => {
      expect(namespace).toBe(FRIEND_SETTINGS_NAMESPACES.stage)
      return { targetFps: 24 }
    })
    const ctx = {
      webServer: {
        register(route: WebRoute) {
          routes.push(route)
          return () => undefined
        },
      },
      effect(execute: () => () => void | Promise<void>) {
        return execute()
      },
      settings: { get: settingsGet },
    }

    apply(ctx)

    expect(name).toBe('@wish233/dsh-friend-stage')
    expect(inject).toEqual(['webServer', 'tools', 'settings', 'agents'])
    expect(routes.some((route) => route.path === FRIEND_EVENTS_PATH && route.kind === 'exact')).toBe(true)
    expect(routes.some((route) => route.path === '/friend/assets' && route.kind === 'prefix')).toBe(true)
    expect(routes.some((route) => route.path === '/friend/live2d/progress')).toBe(true)
    expect(routes.some((route) => route.path === '/friend/stage/performance')).toBe(true)
    expect(routes.some((route) => route.path === '/friend/models/upload')).toBe(true)
    expect(routes.some((route) => route.path === '/friend/stage/chat')).toBe(true)
    expect(routes.some((route) => route.path === '/friend/stage/runtime')).toBe(true)

    const pet = routes.find((route) => route.path === '/friend/pet')
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
    await pet?.handler(
      { method: 'GET', url: '/friend/pet' } as never,
      response as never,
    )
    expect(settingsGet).toHaveBeenCalledWith(FRIEND_SETTINGS_NAMESPACES.stage)
  })

  it('subscribes to companion replies and writes stripped body onto the chat snapshot', () => {
    const handlers = new Set<(session: unknown, event: unknown) => void>()
    const replySource: SessionEventSource = {
      subscribe(handler) {
        handlers.add(handler)
        return () => {
          handlers.delete(handler)
        }
      },
    }
    const chat = createChatTracker()
    const performance = createPerformanceTracker()
    const routes: WebRoute[] = []
    apply({
      webServer: {
        register(route: WebRoute) {
          routes.push(route)
          return () => undefined
        },
      },
      effect(execute: () => () => void | Promise<void>) {
        return execute()
      },
    }, {
      chatTracker: chat,
      performanceTracker: performance,
      replySource,
    })
    for (const handler of handlers) {
      handler(
        { id: 'friend-companion-1', header: { agentPreset: 'friend-companion' } },
        { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '[expr:happy]你好呀' } } },
      )
      handler(
        { id: 'friend-companion-1', header: { agentPreset: 'friend-companion' } },
        { type: 'turn/end', data: { turn: 1 } },
      )
    }
    expect(chat.snapshot().assistantText).toBe('你好呀')
    expect(chat.snapshot().typing).toBe(false)
    expect(performance.snapshot().expression).toBe('happy')
  })
})
