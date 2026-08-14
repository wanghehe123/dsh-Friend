import { describe, expect, it } from 'vitest'

import { createStrictCordisCtx } from '../src/strict-cordis-ctx.ts'

describe('createStrictCordisCtx', () => {
  it('returns declared inject values and throws on undeclared reads', () => {
    const slots = { register() { return () => {} } }
    const ctx = createStrictCordisCtx({
      inject: ['slots'],
      values: { slots },
    })
    expect(ctx.slots).toBe(slots)
    expect(ctx.effect).toBeUndefined()
    expect(ctx.inject).toBeUndefined()
    expect(() => ctx.settingsScope).toThrow(/cannot get property "settingsScope" without inject/)
  })

  it('throws when a service method is destructured and called without this', () => {
    class FakeSettings {
      private readonly bag: Record<string, unknown> = { ok: true }

      get(namespace: string): unknown {
        return this.bag[namespace] ?? this.bag
      }

      async update(namespace: string, patch: Record<string, unknown>): Promise<void> {
        await this.write(namespace, patch)
      }

      private async write(namespace: string, patch: Record<string, unknown>): Promise<void> {
        this.bag[namespace] = { ...patch }
      }
    }

    const settings = new FakeSettings()
    const ctx = createStrictCordisCtx({
      inject: ['settings'],
      values: { settings },
    })
    const live = ctx.settings as FakeSettings
    expect(live.get('friend-core')).toEqual({ ok: true })

    const unboundGet = live.get
    expect(() => unboundGet('friend-core')).toThrow(/receiver was lost/)
    const unboundUpdate = live.update
    expect(() => unboundUpdate('friend-core', { x: 1 })).toThrow(/receiver was lost/)
  })

  it('exposes injected services only through the get trap, never as own properties', () => {
    const agents = { get() { return undefined } }
    const ctx = createStrictCordisCtx({
      inject: ['agents'],
      values: { agents },
    })
    expect(ctx.agents).toBe(agents)
    expect(Object.prototype.hasOwnProperty.call(ctx, 'agents')).toBe(false)
    expect(Object.hasOwn(ctx, 'agents')).toBe(false)
    expect('agents' in ctx).toBe(true)
    expect(Object.keys(ctx)).toEqual([])
  })
})
