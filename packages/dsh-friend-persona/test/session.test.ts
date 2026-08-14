import { describe, expect, it, vi } from 'vitest'

import {
  COMPANION_SESSION_ID_FIELD,
  createMemorySessionIdStore,
  createSettingsSessionIdStore,
  getOrCreateCompanionSession,
  sendToCompanion,
  type CompanionSessionDeps,
} from '../src/session.ts'
import { FRIEND_PRESET_IDS, FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared'
import type { FriendAgentHandle, FriendCreateAgentOptions } from '@wish233/dsh-friend-shared'

function agent(id: string, followup = vi.fn()): FriendAgentHandle & {
  options?: { provider?: string; model?: string }
} {
  return { id, followup }
}

function deps(options: {
  live?: Map<string, FriendAgentHandle>
  create?: (options: FriendCreateAgentOptions) => FriendAgentHandle | Promise<FriendAgentHandle>
  resume?: (id: string) => FriendAgentHandle | Promise<FriendAgentHandle>
  store?: ReturnType<typeof createMemorySessionIdStore>
  warn?: ReturnType<typeof vi.fn>
  getDefaultModel?: CompanionSessionDeps['getDefaultModel']
  mountPreset?: CompanionSessionDeps['mountPreset']
} = {}): CompanionSessionDeps & {
  created: FriendCreateAgentOptions[]
  resumed: Array<{ resumeSessionId: string; agentOptions?: FriendCreateAgentOptions['agentOptions']; setup?: FriendCreateAgentOptions['setup'] }>
  warn: ReturnType<typeof vi.fn>
} {
  const live = options.live ?? new Map<string, FriendAgentHandle>()
  const created: FriendCreateAgentOptions[] = []
  const resumed: Array<{
    resumeSessionId: string
    agentOptions?: FriendCreateAgentOptions['agentOptions']
    setup?: FriendCreateAgentOptions['setup']
  }> = []
  const warn = options.warn ?? vi.fn()
  const store = options.store ?? createMemorySessionIdStore()
  return {
    created,
    resumed,
    warn,
    store,
    cwd: '/tmp/friend-workspace',
    ...(options.getDefaultModel !== undefined ? { getDefaultModel: options.getDefaultModel } : {}),
    ...(options.mountPreset !== undefined ? { mountPreset: options.mountPreset } : {}),
    registry: {
      get(id) {
        return live.get(id)
      },
      async create(spec) {
        created.push(spec)
        const next = options.create === undefined
          ? agent(spec.sessionId)
          : await options.create(spec)
        live.set(next.id, next)
        return { agent: next, dispose: async () => undefined }
      },
      ...(options.resume === undefined
        ? {}
        : {
            async resume(spec: {
              resumeSessionId: string
              agentOptions?: FriendCreateAgentOptions['agentOptions']
              setup?: FriendCreateAgentOptions['setup']
            }) {
              resumed.push(spec)
              const resume = options.resume
              if (resume === undefined) {
                throw new Error('resume omitted')
              }
              const next = await resume(spec.resumeSessionId)
              return { agent: next, dispose: async () => undefined }
            },
          }),
    },
  }
}

describe('getOrCreateCompanionSession', () => {
  it('creates and persists an id when none is stored', async () => {
    const source = deps()
    const handle = await getOrCreateCompanionSession(source)

    expect(handle.agent).toBeDefined()
    expect(handle.id).toMatch(/^friend-companion-/)
    expect(source.store.get()).toBe(handle.id)
    expect(source.created).toHaveLength(1)
    expect(source.created[0]?.meta).toEqual({
      agentPreset: FRIEND_PRESET_IDS.companion,
      cwd: '/tmp/friend-workspace',
    })
  })

  it('stamps the default model and mounts friend-companion in setup', async () => {
    const mounted: Array<[unknown, string]> = []
    const source = deps({
      getDefaultModel: () => ({
        provider: 'opencode-go',
        model: 'deepseek-v4-pro',
        reasoningEffort: 'max',
      }),
      mountPreset: async (agentCtx, id) => {
        mounted.push([agentCtx, id])
      },
    })

    await getOrCreateCompanionSession(source)
    const created = source.created[0]
    expect(created?.agentOptions).toEqual({
      provider: 'opencode-go',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })
    expect(created?.setup).toBeTypeOf('function')
    const agentCtx = { id: 'scoped-agent' }
    await created?.setup?.(agentCtx)
    expect(mounted).toEqual([[agentCtx, FRIEND_PRESET_IDS.companion]])
  })

  it('resumes with the same model stamp and preset mount', async () => {
    const mounted: string[] = []
    const existing = agent('session-persisted')
    const source = deps({
      store: createMemorySessionIdStore('session-persisted'),
      resume: async () => existing,
      getDefaultModel: () => ({ provider: 'opencode-go', model: 'deepseek-v4-pro' }),
      mountPreset: async (_agentCtx, id) => {
        mounted.push(id)
      },
    })

    const handle = await getOrCreateCompanionSession(source)
    expect(handle.agent).toBe(existing)
    expect(source.created).toHaveLength(0)
    expect(source.resumed[0]?.agentOptions).toEqual({
      provider: 'opencode-go',
      model: 'deepseek-v4-pro',
    })
    await source.resumed[0]?.setup?.({ id: 'resumed-ctx' })
    expect(mounted).toEqual([FRIEND_PRESET_IDS.companion])
  })

  it('reuses a live agent only when it already has a model route', async () => {
    const existing = agent('session-live')
    existing.options = { provider: 'opencode-go', model: 'deepseek-v4-pro' }
    const source = deps({
      live: new Map([['session-live', existing]]),
      store: createMemorySessionIdStore('session-live'),
    })

    const handle = await getOrCreateCompanionSession(source)
    expect(handle.agent).toBe(existing)
    expect(handle.id).toBe('session-live')
    expect(source.created).toHaveLength(0)
  })

  it('rebuilds a live agent that has no model route before the first send', async () => {
    const existing = agent('session-live')
    const mounted: string[] = []
    const source = deps({
      live: new Map([['session-live', existing]]),
      store: createMemorySessionIdStore('session-live'),
      getDefaultModel: () => ({
        provider: 'opencode-go',
        model: 'deepseek-v4-pro',
        reasoningEffort: 'max',
      }),
      mountPreset: async (_agentCtx, id) => {
        mounted.push(id)
      },
    })

    const handle = await getOrCreateCompanionSession(source)
    expect(handle.agent).not.toBe(existing)
    expect(handle.id).not.toBe('session-live')
    expect(handle.id).toMatch(/^friend-companion-/)
    expect(source.created).toHaveLength(1)
    expect(source.created[0]?.agentOptions).toEqual({
      provider: 'opencode-go',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })
    await source.created[0]?.setup?.({ id: 'rebuilt-ctx' })
    expect(mounted).toEqual([FRIEND_PRESET_IDS.companion])
    expect(source.warn).toHaveBeenCalledWith(expect.stringMatching(/no model route/))
  })

  it('rebuilds when the stored id is missing from the live registry and resume fails', async () => {
    const source = deps({
      store: createMemorySessionIdStore('session-deleted'),
      resume: async () => {
        throw new Error('SESSION_NOT_FOUND')
      },
    })

    const handle = await getOrCreateCompanionSession(source)
    expect(handle.id).not.toBe('session-deleted')
    expect(handle.id).toMatch(/^friend-companion-/)
    expect(source.store.get()).toBe(handle.id)
    expect(source.created).toHaveLength(1)
    expect(source.warn).toHaveBeenCalledWith(expect.stringMatching(/is gone/))
  })
})

describe('sendToCompanion', () => {
  it('followups the standing session', async () => {
    const followup = vi.fn()
    const existing = agent('session-live', followup)
    existing.options = { provider: 'opencode-go', model: 'deepseek-v4-pro' }
    const source = deps({
      live: new Map([['session-live', existing]]),
      store: createMemorySessionIdStore('session-live'),
    })

    const result = await sendToCompanion('你好', source)
    expect(result).toEqual({ sessionId: 'session-live', sent: true })
    expect(followup).toHaveBeenCalledOnce()
    expect(followup.mock.calls[0]?.[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: '你好' }],
    })
  })

  it('rebuilds then sends when the stored session is invalid', async () => {
    const followup = vi.fn()
    const source = deps({
      store: createMemorySessionIdStore('missing'),
      create: (spec) => agent(spec.sessionId, followup),
    })

    const result = await sendToCompanion('ping', source)
    expect(result.sent).toBe(true)
    expect(result.sessionId).not.toBe('missing')
    expect(followup).toHaveBeenCalledOnce()
  })

  it('returns the create failure instead of a generic empty session', async () => {
    const source = deps({
      create: async () => {
        throw new Error('preset "friend-companion": 1 row(s) did not activate')
      },
    })

    const result = await sendToCompanion('你好', source)
    expect(result).toEqual({
      sessionId: '',
      sent: false,
      error: 'preset "friend-companion": 1 row(s) did not activate',
    })
  })
})

describe('createSettingsSessionIdStore', () => {
  it('reads and writes friend-core.companionSessionId', async () => {
    const document: Record<string, Record<string, unknown>> = {
      [FRIEND_SETTINGS_NAMESPACES.core]: {},
    }
    const store = createSettingsSessionIdStore({
      get(namespace) {
        return document[namespace]
      },
      async update(namespace, patch) {
        document[namespace] = { ...document[namespace], ...patch }
      },
    })

    expect(store.get()).toBeUndefined()
    await store.set('session-abc')
    expect(store.get()).toBe('session-abc')
    expect(document[FRIEND_SETTINGS_NAMESPACES.core]?.[COMPANION_SESSION_ID_FIELD]).toBe(
      'session-abc',
    )
  })

  it('keeps this when settings.update is a class method that calls this.write', async () => {
    class FakeSettings {
      private readonly sections: Record<string, Record<string, unknown>> = {
        [FRIEND_SETTINGS_NAMESPACES.core]: {},
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
    await expect(
      unbound.call({} as FakeSettings, FRIEND_SETTINGS_NAMESPACES.core, { x: 1 }),
    ).rejects.toThrow(/write is not a function/)

    const store = createSettingsSessionIdStore(settings)
    await store.set('session-live')
    expect(store.get()).toBe('session-live')
  })
})
