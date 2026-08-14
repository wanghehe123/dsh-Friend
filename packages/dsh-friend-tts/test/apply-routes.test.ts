import { describe, expect, it, vi } from 'vitest'

import type { SessionEventSource } from '@wishp3/dsh-friend-persona'

import { createFriendSettingsInstallProbe, createStrictCordisCtx, FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared'

import { apply, createFriendTtsHost, inject } from '../src/index.ts'
import { FRIEND_TTS_AUDIO_PATH, FRIEND_TTS_EVENTS_PATH, FRIEND_TTS_PREVIEW_PATH } from '../src/paths.ts'
import type { FriendTtsReadyEvent } from '../src/playback-events.ts'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

describe('createFriendTtsHost + apply routes', () => {
  it('registers friend-tts on the production path', () => {
    const probe = createFriendSettingsInstallProbe()
    apply({ ...probe }, { cacheDir: null })
    expect(probe.registered.map((item) => item.ns)).toEqual([FRIEND_SETTINGS_NAMESPACES.tts])
  })

  it('declares webServer inject so Cordis will not throw on ctx.webServer', () => {
    expect(inject).toEqual(['webServer', 'settings'])
  })

  it('registers edge, openai-compat, dashscope, and minimax and disposes them', () => {
    const host = createFriendTtsHost({
      edge: {
        connect: () => {
          throw new Error('unit tests must not open a websocket')
        },
      },
    })
    expect(host.registry.get('edge')?.id).toBe('edge')
    expect(host.registry.get('openai-compat')?.id).toBe('openai-compat')
    expect(host.registry.get('dashscope')?.id).toBe('dashscope')
    expect(host.registry.get('minimax')?.id).toBe('minimax')
    host.dispose()
    expect(host.registry.get('edge')).toBeUndefined()
    expect(host.registry.get('openai-compat')).toBeUndefined()
    expect(host.registry.get('dashscope')).toBeUndefined()
    expect(host.registry.get('minimax')).toBeUndefined()
  })

  it('speakReply follows live getConfig().autoSpeak without synthesizing when off', async () => {
    let autoSpeak = false
    const host = createFriendTtsHost({
      getConfig: () => ({ autoSpeak }),
      edge: {
        connect: () => {
          throw new Error('autoSpeak off must not open a websocket')
        },
      },
    })
    const silenced = await host.service.speakReply('你好。世界。')
    expect(silenced.first).toBeUndefined()
    expect(silenced.sentences).toEqual(['你好。', '世界。'])

    autoSpeak = true
    const spoken = await host.service.speakReply('开启后朗读。')
    expect(spoken.first).toBeDefined()
    host.dispose()
  })

  it('registers the audio prefix route when webServer is present', () => {
    const routes: WebRoute[] = []
    const effect = vi.fn((execute: () => () => void) => execute())
    apply({
      effect,
      webServer: {
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
    })
    expect(routes.some((route) => route.kind === 'prefix' && route.path === FRIEND_TTS_AUDIO_PATH)).toBe(true)
    expect(routes.some((route) => route.kind === 'exact' && route.path === FRIEND_TTS_EVENTS_PATH)).toBe(true)
    expect(routes.some((route) => route.kind === 'exact' && route.path === FRIEND_TTS_PREVIEW_PATH)).toBe(true)
    expect(routes.some((route) => route.path === '/friend/events')).toBe(false)
    expect(effect.mock.calls.some((call) => call[1] === 'dsh-friend-tts: providers')).toBe(true)
    expect(effect.mock.calls.some((call) => call[1] === `dsh-friend: prefix ${FRIEND_TTS_AUDIO_PATH}`)).toBe(true)
    expect(effect.mock.calls.some((call) => call[1] === `dsh-friend: exact ${FRIEND_TTS_EVENTS_PATH}`)).toBe(true)
    expect(effect.mock.calls.some((call) => call[1] === `dsh-friend: exact ${FRIEND_TTS_PREVIEW_PATH}`)).toBe(true)
  })

  it('does not register /friend/tts/events when a push sink is injected', () => {
    const routes: WebRoute[] = []
    apply({
      effect: (execute) => execute(),
      webServer: {
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
    }, { push: { push() {} } })
    expect(routes.some((route) => route.path === FRIEND_TTS_EVENTS_PATH)).toBe(false)
    expect(routes.some((route) => route.path === '/friend/events')).toBe(false)
    expect(routes.some((route) => route.path === FRIEND_TTS_AUDIO_PATH)).toBe(true)
    expect(routes.some((route) => route.path === FRIEND_TTS_PREVIEW_PATH)).toBe(true)
  })

  it('wires companion replies to speakReply and skips synthesis when autoSpeak is off', async () => {
    const handlers = new Set<(session: unknown, event: unknown) => void>()
    const replySource: SessionEventSource = {
      subscribe(handler) {
        handlers.add(handler)
        return () => {
          handlers.delete(handler)
        }
      },
    }
    const onSpeak = vi.fn()
    apply({
      effect: (execute) => execute(),
      settings: {
        get: () => ({ autoSpeak: false }),
      },
    }, { replySource, onSpeak })
    for (const handler of handlers) {
      handler(
        { id: 'friend-companion-1', header: { agentPreset: 'friend-companion' } },
        { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '[expr:happy]不应合成。' } } },
      )
      handler(
        { id: 'friend-companion-1', header: { agentPreset: 'friend-companion' } },
        { type: 'turn/end', data: { turn: 1 } },
      )
    }
    await Promise.resolve()
    expect(onSpeak).not.toHaveBeenCalled()
  })

  it('pushes tts-ready on companion replies when the browser provider is selected', async () => {
    const handlers = new Set<(session: unknown, event: unknown) => void>()
    const replySource: SessionEventSource = {
      subscribe(handler) {
        handlers.add(handler)
        return () => {
          handlers.delete(handler)
        }
      },
    }
    const pushed: FriendTtsReadyEvent[] = []
    apply({
      effect: (execute) => execute(),
      settings: {
        get: () => ({ provider: 'browser', autoSpeak: true }),
      },
    }, {
      replySource,
      cacheDir: null,
      push: {
        push(event) {
          pushed.push(event)
        },
      },
    })
    for (const handler of handlers) {
      handler(
        { id: 'friend-companion-1', header: { agentPreset: 'friend-companion' } },
        { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '你好呀。' } } },
      )
      handler(
        { id: 'friend-companion-1', header: { agentPreset: 'friend-companion' } },
        { type: 'turn/end', data: { turn: 1 } },
      )
    }
    const started = Date.now()
    while (pushed.length === 0 && Date.now() - started < 500) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(pushed.some((event) => event.type === 'tts-ready' && event.payload.kind === 'browser-fallback')).toBe(true)
    expect(JSON.stringify(pushed)).not.toMatch(/"audio"\s*:/u)
  })
})

describe('standing session id keeps the settings receiver', () => {
  it('reads companionSessionId through bindHostSettings on a this-dependent service', async () => {
    class FakeSettings {
      private readonly sections: Record<string, Record<string, unknown>> = {
        'friend-core': { companionSessionId: 'keep-me' },
        'friend-tts': { autoSpeak: true, provider: 'browser' },
      }

      get(namespace: string): unknown {
        return this.sections[namespace]
      }

      async update(namespace: string, patch: Record<string, unknown>): Promise<void> {
        await this.write(namespace, patch)
      }

      private async write(namespace: string, patch: Record<string, unknown>): Promise<void> {
        this.sections[namespace] = { ...this.sections[namespace], ...patch }
      }
    }

    const settings = new FakeSettings()
    const handlers = new Set<(session: unknown, event: unknown) => void>()
    const replySource: SessionEventSource = {
      subscribe(handler) {
        handlers.add(handler)
        return () => {
          handlers.delete(handler)
        }
      },
    }
    const spoken: unknown[] = []
    const ctx = createStrictCordisCtx({
      inject: ['webServer', 'settings'],
      values: {
        settings,
        effect(execute: () => () => void) {
          execute()
        },
        webServer: {
          register() {
            return () => undefined
          },
        },
      },
    })

    apply(ctx, {
      replySource,
      cacheDir: null,
      onSpeak: (result) => {
        spoken.push(result)
      },
    })
    for (const handler of handlers) {
      handler(
        { id: 'keep-me', header: { agentPreset: 'other-preset' } },
        { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '你好。' } } },
      )
      handler(
        { id: 'keep-me', header: { agentPreset: 'other-preset' } },
        { type: 'turn/end', data: { turn: 1 } },
      )
    }
    const started = Date.now()
    while (spoken.length === 0 && Date.now() - started < 500) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(spoken.length, 'standing session id must be readable; destructuring settings.get loses this').toBeGreaterThan(0)
  })
})
