import { describe, expect, it } from 'vitest'

import {
  createFriendSettingsInstallProbe,
  createStrictCordisCtx,
  FRIEND_SETTINGS_NAMESPACES,
} from '@wish233/dsh-friend-shared'

import {
  applyReactions,
  inject,
  name,
  normalizeSessionEventArgs,
  SESSION_EVENT_NAME,
  wrapContextEvents,
  type FriendReactionsContext,
} from '../src/index.ts'
import { renderReactionsPage } from '../src/ui-page.ts'

/**
 * `ctx.on` is a Cordis Context method, not a plugin service. The plugin
 * `export const inject` stays `['webServer', 'settings']`. The strict test
 * double only allows listed names, so tests that read `ctx.on` must allow
 * it here — same class as the helper's built-in `effect` intrinsic.
 */
const HOST_INJECT = [...inject, 'on'] as const

function codingSession(id = 'code-1'): { id: string; header: { agentPreset: string } } {
  return { id, header: { agentPreset: 'coding' } }
}

function hostCtx(values: Record<string, unknown> = {}): FriendReactionsContext {
  return createStrictCordisCtx({
    inject: HOST_INJECT,
    values: {
      on: undefined,
      ...values,
    },
  }) as FriendReactionsContext
}

describe('cordis inject', () => {
  it('declares the services apply() may read', () => {
    expect(inject).toEqual(['webServer', 'settings'])
    expect(name).toBe('@wish233/dsh-friend-reactions')
  })
})

describe('apply() role split', () => {
  it('registers friend-reactions on the production host path', () => {
    const probe = createFriendSettingsInstallProbe()
    const ctx = hostCtx({
      inject: probe.inject.bind(probe),
      fiber: probe.fiber,
    })
    const handle = applyReactions(ctx, { role: 'host' })
    expect(probe.registered.map((item) => item.ns)).toEqual([FRIEND_SETTINGS_NAMESPACES.reactions])
    handle.dispose()
  })

  it('host apply mounts reaction routes and reacts through ctx.on(session/event)', () => {
    const routes: Array<{ path: string }> = []
    const listeners: Array<(...args: unknown[]) => void> = []
    const ctx = hostCtx({
      webServer: {
        register(route: { path: string }) {
          routes.push(route)
          return () => undefined
        },
      },
      effect: (execute: () => () => void) => execute(),
      on(event: string, handler: (...args: unknown[]) => void) {
        expect(event).toBe(SESSION_EVENT_NAME)
        listeners.push(handler)
        return () => undefined
      },
    })
    const handle = applyReactions(ctx, { role: 'host', now: () => 1_000, random: () => 0 })
    expect(handle.role).toBe('host')
    expect(routes.some((item) => item.path === '/friend/reactions')).toBe(true)
    expect(routes.some((item) => item.path === '/friend/reactions/events')).toBe(true)
    expect(listeners).toHaveLength(1)
    listeners[0]?.(
      codingSession(),
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, text: 'should-not-leak' },
    )
    expect(handle.engine.last()?.cue).toBe('success')
    expect(JSON.stringify(handle.engine.last())).not.toContain('should-not-leak')
    handle.dispose()
  })

  it('companion-preset is a defensive no-op (neither preset yml mounts this plugin)', () => {
    const routes: Array<{ path: string }> = []
    const ctx = hostCtx({
      webServer: {
        register(route: { path: string }) {
          routes.push(route)
          return () => undefined
        },
      },
      effect: (execute: () => () => void) => execute(),
    })
    const handle = applyReactions(ctx, { role: 'companion-preset' })
    expect(handle.role).toBe('companion-preset')
    expect(routes).toEqual([])
    expect(handle.notify(codingSession(), { type: 'turn/start', data: { turn: 1 } })).toBeUndefined()
  })

  it('produces nothing while friend-core.enabled is false and resumes after it is restored', () => {
    const bag: Record<string, Record<string, unknown>> = {
      [FRIEND_SETTINGS_NAMESPACES.core]: { enabled: true },
      [FRIEND_SETTINGS_NAMESPACES.reactions]: { enabled: true },
    }
    const listeners: Array<(...args: unknown[]) => void> = []
    let now = 1_000
    const ctx = hostCtx({
      settings: {
        get(namespace: string) {
          return bag[namespace]
        },
      },
      on(_event: string, handler: (...args: unknown[]) => void) {
        listeners.push(handler)
        return () => undefined
      },
    })
    const handle = applyReactions(ctx, { role: 'host', now: () => now, random: () => 0 })
    listeners[0]?.(codingSession('s1'), { type: 'turn/start', data: { turn: 1 } })
    expect(handle.engine.last()?.kind).toBe('turn-start')

    bag[FRIEND_SETTINGS_NAMESPACES.core] = { enabled: false }
    listeners[0]?.(codingSession('s1'), {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    })
    expect(handle.engine.last()?.kind).toBe('turn-start')
    expect(handle.engine.decide({ kind: 'turn-success', sessionId: 's1' })).toEqual({
      allowed: false,
      reason: 'disabled',
    })

    bag[FRIEND_SETTINGS_NAMESPACES.core] = { enabled: true }
    now = 1_000 + 10 * 60_000
    listeners[0]?.(codingSession('s1'), {
      type: 'tool/result',
      data: { error: { name: 'ToolError', code: 'FAILED' } },
    })
    expect(handle.engine.last()?.kind).toBe('tool-error')
    handle.dispose()
  })

  it('stays silent when only friend-reactions.enabled is false', () => {
    const listeners: Array<(...args: unknown[]) => void> = []
    const ctx = hostCtx({
      settings: {
        get(namespace: string) {
          if (namespace === FRIEND_SETTINGS_NAMESPACES.core) {
            return { enabled: true }
          }
          if (namespace === FRIEND_SETTINGS_NAMESPACES.reactions) {
            return { enabled: false }
          }
          return undefined
        },
      },
      on(_event: string, handler: (...args: unknown[]) => void) {
        listeners.push(handler)
        return () => undefined
      },
    })
    const handle = applyReactions(ctx, { role: 'host', now: () => 1_000, random: () => 0 })
    listeners[0]?.(codingSession('s1'), { type: 'turn/start', data: { turn: 1 } })
    expect(handle.engine.last()).toBeUndefined()
    handle.dispose()
  })
})

describe('wrapContextEvents official (session, event) arity', () => {
  it('forwards both arguments from ctx.on so a Session-only args[0] cannot classify', () => {
    const listeners: Array<(...args: unknown[]) => void> = []
    const ctx = hostCtx({
      on(event: string, handler: (...args: unknown[]) => void) {
        expect(event).toBe(SESSION_EVENT_NAME)
        listeners.push(handler)
        return () => undefined
      },
    })
    const handle = applyReactions(ctx, { now: () => 2_000, random: () => 0 })
    const session = codingSession()
    const event = { type: 'turn/start', data: { turn: 1 } }

    listeners[0]?.(session)
    expect(handle.engine.last()).toBeUndefined()

    listeners[0]?.(session, event)
    expect(handle.engine.last()?.kind).toBe('turn-start')
    handle.dispose()
  })

  it('normalizeSessionEventArgs keeps the official pair and does not invent a type on Session', () => {
    const session = codingSession()
    const event = { type: 'turn/start', data: { turn: 1 } }
    expect(normalizeSessionEventArgs([session, event])).toEqual({ session, event })
    expect(normalizeSessionEventArgs([session])).toEqual({ session, event: undefined })
    expect(normalizeSessionEventArgs([{ session, event }])).toEqual({ session, event })
  })

  it('returns undefined when ctx.on is missing', () => {
    expect(wrapContextEvents(hostCtx())).toBeUndefined()
  })
})

describe('work-companion page', () => {
  it('renders level controls', () => {
    const html = renderReactionsPage()
    expect(html).toContain('仅动作')
    expect(html).toContain('动作+气泡')
    expect(html).toContain('动作+语音')
    expect(html).toContain('/friend/reactions/events')
  })
})
