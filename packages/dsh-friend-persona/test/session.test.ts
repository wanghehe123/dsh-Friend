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

function agent(id: string, followup = vi.fn()): FriendAgentHandle {
  return { id, followup }
}

function deps(options: {
  live?: Map<string, FriendAgentHandle>
  create?: (options: FriendCreateAgentOptions) => FriendAgentHandle | Promise<FriendAgentHandle>
  resume?: (id: string) => FriendAgentHandle | Promise<FriendAgentHandle>
  store?: ReturnType<typeof createMemorySessionIdStore>
  warn?: ReturnType<typeof vi.fn>
} = {}): CompanionSessionDeps & {
  created: FriendCreateAgentOptions[]
  warn: ReturnType<typeof vi.fn>
} {
  const live = options.live ?? new Map<string, FriendAgentHandle>()
  const created: FriendCreateAgentOptions[] = []
  const warn = options.warn ?? vi.fn()
  const store = options.store ?? createMemorySessionIdStore()
  return {
    created,
    warn,
    store,
    cwd: '/tmp/friend-workspace',
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
            async resume({ resumeSessionId }: { resumeSessionId: string }) {
              const resume = options.resume
              if (resume === undefined) {
                throw new Error('resume omitted')
              }
              const resumed = await resume(resumeSessionId)
              return { agent: resumed, dispose: async () => undefined }
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

  it('reuses a live agent when the stored id is still valid', async () => {
    const existing = agent('session-live')
    const source = deps({
      live: new Map([['session-live', existing]]),
      store: createMemorySessionIdStore('session-live'),
    })

    const handle = await getOrCreateCompanionSession(source)
    expect(handle.agent).toBe(existing)
    expect(handle.id).toBe('session-live')
    expect(source.created).toHaveLength(0)
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
