import { describe, expect, it, vi } from 'vitest'

import type { Context } from '@deepseek-ai/cordis'

import { bindSettingsClient } from '../src/compat/settings-client.ts'
import {
  bindHostSettings,
  bindSettingsHost,
  createFriendSettingsInstallProbe,
  FRIEND_SETTINGS_NAMESPACES,
  registerFriendSettings,
  Schema,
  type FriendSettingsNamespace,
} from '../src/dsh-compat.ts'

describe('bindSettingsHost', () => {
  it('installs the kebab namespace through settingsNamespace + installSettingsSection', () => {
    const entry = { enabled: true }
    const schema = Schema.object({ enabled: Schema.boolean() })
    const hooks = {
      setSource: vi.fn(),
      onChange: vi.fn(),
    }
    const get = vi.fn(() => entry)
    const watch = vi.fn()
    const register = vi.fn(() => ({ get, watch }))
    const inject = vi.fn((deps: string[], callback: (sctx: {
      settings: { register: typeof register }
      effect: (execute: () => () => void) => void
    }) => void) => {
      expect(deps).toEqual(['settings'])
      callback({
        settings: { register },
        effect: (execute) => {
          execute()
        },
      })
    })
    const ctx = { inject, fiber: { state: 0 } } as unknown as Context

    bindSettingsHost(ctx, FRIEND_SETTINGS_NAMESPACES.core, schema, entry, hooks)

    expect(register).toHaveBeenCalledOnce()
    const [ns, passedSchema, options] = register.mock.calls[0] ?? []
    expect(ns).toBe('friend-core')
    expect(passedSchema).toBe(schema)
    expect(options).toEqual({ base: entry })
    expect(hooks.setSource).toHaveBeenCalledOnce()
    expect(hooks.onChange).toHaveBeenCalledOnce()
  })

  it('rejects a dotted namespace before touching ctx.inject', () => {
    const inject = vi.fn()
    const ctx = { inject, fiber: { state: 0 } } as unknown as Context

    expect(() => bindSettingsHost(
      ctx,
      'friend.core' as FriendSettingsNamespace,
      Schema.object({}),
      {},
      { setSource: vi.fn(), onChange: vi.fn() },
    )).toThrow(/settings namespace/)
    expect(inject).not.toHaveBeenCalled()
  })
})

describe('Schema runtime re-export', () => {
  it('constructs a real schemastery schema without a feature-package import', () => {
    const schema = Schema.object({
      enabled: Schema.boolean().default(true),
      companionSessionId: Schema.string(),
    })
    expect(schema({ enabled: false, companionSessionId: 's1' })).toEqual({
      enabled: false,
      companionSessionId: 's1',
    })
    expect(schema({}).enabled).toBe(true)
  })
})

describe('registerFriendSettings', () => {
  it('registers through inject on a production-shaped ctx', () => {
    const probe = createFriendSettingsInstallProbe()
    const schema = Schema.object({ enabled: Schema.boolean() })
    registerFriendSettings(probe, FRIEND_SETTINGS_NAMESPACES.core, schema, { enabled: true })
    expect(probe.registered).toHaveLength(1)
    expect(probe.registered[0]?.ns).toBe('friend-core')
    expect(probe.registered[0]?.schema).toBe(schema)
  })

  it('skips plain test fakes that have no inject (does not throw)', () => {
    expect(() => registerFriendSettings(
      {},
      FRIEND_SETTINGS_NAMESPACES.tts,
      Schema.object({}),
      {},
    )).not.toThrow()
  })
})

describe('bindHostSettings', () => {
  it('keeps this so SettingsProvider.update can call this.write', async () => {
    class FakeSettings {
      private readonly sections: Record<string, Record<string, unknown>> = {
        'friend-core': {},
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
    const unbound = settings.update
    await expect(unbound.call({} as FakeSettings, 'friend-core', { companionSessionId: 'x' })).rejects.toThrow(
      /write is not a function/,
    )

    const bound = bindHostSettings(settings)
    await bound.update('friend-core', { companionSessionId: 'x' })
    expect(bound.get('friend-core')).toEqual({ companionSessionId: 'x' })
  })
})

describe('bindSettingsClient', () => {
  it('forwards { namespace } to settingsScope.bind', () => {
    const scope = {
      getSnapshot: vi.fn(),
      subscribe: vi.fn(),
      set: vi.fn(),
      unset: vi.fn(),
    }
    const bind = vi.fn(() => scope)
    const spec = { namespace: FRIEND_SETTINGS_NAMESPACES.persona }

    const result = bindSettingsClient({ bind }, spec)

    expect(bind).toHaveBeenCalledWith(spec)
    expect(result).toBe(scope)
  })
})
