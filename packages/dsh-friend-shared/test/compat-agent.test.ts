import { describe, expect, it, vi } from 'vitest'

import {
  createAgent,
  createFriendUserMessage,
  followupText,
  getLiveAgent,
  resumeAgent,
  unwrapCreatedAgent,
  type FriendAgentCreateResult,
  type FriendAgentHandle,
} from '../src/compat/agent.ts'

function fakeAgent(id: string, followup = vi.fn()): FriendAgentHandle {
  return { id, followup }
}

function created(agent: FriendAgentHandle): FriendAgentCreateResult {
  return { agent, dispose: async () => undefined }
}

describe('getLiveAgent', () => {
  it('forwards to registry.get', () => {
    const agent = fakeAgent('session-1')
    const get = vi.fn(() => agent)
    expect(getLiveAgent({ get, create: vi.fn() }, 'session-1')).toBe(agent)
    expect(get).toHaveBeenCalledWith('session-1')
  })
})

describe('resumeAgent', () => {
  it('returns undefined when resume is missing or rejects', async () => {
    await expect(resumeAgent({ get: vi.fn(), create: vi.fn() }, 's')).resolves.toBeUndefined()
    const resume = vi.fn(async () => {
      throw new Error('SESSION_NOT_FOUND')
    })
    await expect(
      resumeAgent({ get: vi.fn(), create: vi.fn(), resume }, 'gone'),
    ).resolves.toBeUndefined()
  })

  it('unwraps { agent, dispose } from a successful resume', async () => {
    const agent = fakeAgent('resumed')
    const resume = vi.fn(async () => created(agent))
    await expect(
      resumeAgent({ get: vi.fn(), create: vi.fn(), resume }, 'resumed'),
    ).resolves.toBe(agent)
  })
})

describe('createAgent', () => {
  it('unwraps the live ReactLoopAgent-shaped handle from create()', async () => {
    const agent = fakeAgent('friend-companion-1')
    const create = vi.fn(async () => created(agent))
    await expect(createAgent({ get: vi.fn(), create }, { sessionId: 'friend-companion-1' })).resolves.toBe(agent)
    expect(create).toHaveBeenCalledWith({ sessionId: 'friend-companion-1' })
  })
})

describe('unwrapCreatedAgent', () => {
  it('rejects a create() result that is not { agent } with followup', () => {
    expect(() => unwrapCreatedAgent({
      agent: { id: 'x' } as FriendAgentHandle,
      dispose: async () => undefined,
    })).toThrow(/followup/)
  })
})

describe('followupText', () => {
  it('builds a user-role text message and calls agent.followup', () => {
    const followup = vi.fn()
    followupText(fakeAgent('s', followup), 'hello')
    expect(followup).toHaveBeenCalledOnce()
    const message = followup.mock.calls[0]?.[0]
    expect(message).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    })
    expect(typeof message?.id).toBe('string')
    expect(message?.id.length).toBeGreaterThan(0)
  })
})

describe('createFriendUserMessage', () => {
  it('assigns a fresh id per call', () => {
    const a = createFriendUserMessage('a')
    const b = createFriendUserMessage('a')
    expect(a.id).not.toBe(b.id)
  })
})
