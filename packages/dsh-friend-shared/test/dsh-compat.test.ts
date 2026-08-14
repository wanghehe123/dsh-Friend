import { describe, expect, it, vi } from 'vitest'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { registerRoute, type FriendRouteContext } from '../src/dsh-compat.ts'

function mockRouteContext() {
  const disposeRoute = vi.fn()
  const register = vi.fn<(route: WebRoute) => () => void>(() => disposeRoute)
  const effect = vi.fn<FriendRouteContext['effect']>((callback) => callback())
  const ctx = {
    effect,
    webServer: { register },
  } satisfies FriendRouteContext
  return { ctx, effect, register, disposeRoute }
}

describe('registerRoute', () => {
  it('delegates through ctx.effect and releases the HTTP route with its plugin fiber', () => {
    const { ctx, effect, register, disposeRoute } = mockRouteContext()
    const route = {
      kind: 'exact' as const,
      path: '/friend/pet',
      handler: vi.fn(),
    }

    const dispose = registerRoute(ctx, route)

    expect(effect).toHaveBeenCalledOnce()
    expect(effect.mock.calls[0]?.[1]).toBe('dsh-friend: exact /friend/pet')
    expect(effect.mock.calls[0]?.[1]).not.toMatch(/GET/)
    expect(register).toHaveBeenCalledWith(route)
    dispose()
    expect(disposeRoute).toHaveBeenCalledOnce()
  })

  it('rejects a trailing-slash path before touching webServer.register', () => {
    const { ctx, effect, register } = mockRouteContext()

    expect(() => registerRoute(ctx, {
      kind: 'exact',
      path: '/friend/pet/',
      handler: vi.fn(),
    })).toThrow(/must not end with "\/": \/friend\/pet\//)

    expect(effect).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
  })

  it('allows the root path "/" and labels prefix routes without GET', () => {
    const { ctx, effect, register } = mockRouteContext()
    const route = {
      kind: 'prefix' as const,
      path: '/friend/tts/audio',
      handler: vi.fn(),
    }

    registerRoute(ctx, route)

    expect(register).toHaveBeenCalledWith(route)
    expect(effect.mock.calls[0]?.[1]).toBe('dsh-friend: prefix /friend/tts/audio')
    expect(effect.mock.calls[0]?.[1]).not.toMatch(/GET/)

    const { ctx: rootCtx, effect: rootEffect } = mockRouteContext()
    registerRoute(rootCtx, {
      kind: 'exact',
      path: '/',
      handler: vi.fn(),
    })
    expect(rootEffect.mock.calls[0]?.[1]).toBe('dsh-friend: exact /')
  })
})
