import { describe, expect, it, vi } from 'vitest'

import { createStrictCordisCtx } from '@wishp3/dsh-friend-shared'
import type { FriendAgentHandle, FriendCreateAgentOptions } from '@wishp3/dsh-friend-shared'

import { bindPersonaSend, bindPersonaWatch, type CompanionSendContext } from '../src/companion-send.ts'

function fakeAgents(followup = vi.fn()) {
  const live = new Map<string, FriendAgentHandle>()
  return {
    followup,
    agents: {
      get(id: string) {
        return live.get(id)
      },
      async create(options: FriendCreateAgentOptions) {
        const agent = { id: options.sessionId, followup }
        live.set(agent.id, agent)
        return { agent, dispose: async () => undefined }
      },
    },
  }
}

describe('persona send seam', () => {
  it('binds sendToCompanion when ctx.agents is resolved (Cordis get trap, not an own property)', async () => {
    const { followup, agents } = fakeAgents()
    const ctx = createStrictCordisCtx({
      inject: ['agents', 'settings', 'agentDefaultModel', 'agentPresets'],
      values: { agents },
    })
    const send = bindPersonaSend(ctx as CompanionSendContext)
    expect(send).toBeDefined()
    const result = await send?.('你好')
    expect(result?.sent).toBe(true)
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('binds sendToCompanion when agents lives on the prototype (Cordis-like)', async () => {
    const { followup, agents } = fakeAgents()
    const ctx = Object.create({ agents }) as CompanionSendContext
    expect(Object.prototype.hasOwnProperty.call(ctx, 'agents')).toBe(false)
    const send = bindPersonaSend(ctx)
    expect(send).toBeDefined()
    const result = await send?.('你好')
    expect(result?.sent).toBe(true)
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('bindPersonaWatch strips tags from session/event deltas', () => {
    const listeners: Array<(...args: unknown[]) => void> = []
    const ctx = {
      on(event: string, handler: (...args: unknown[]) => void) {
        expect(event).toBe('session/event')
        listeners.push(handler)
        return () => undefined
      },
    }
    const watch = bindPersonaWatch(ctx)
    expect(watch).toBeDefined()
    const seen: Array<{ text: string; done: boolean }> = []
    watch?.('friend-companion-1', (text, done) => {
      seen.push({ text, done })
    })
    listeners[0]?.(
      { id: 'friend-companion-1', header: { agentPreset: 'friend-companion' } },
      { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '[expr:happy]你好' } } },
    )
    listeners[0]?.(
      { id: 'friend-companion-1', header: { agentPreset: 'friend-companion' } },
      { type: 'turn/end', data: { turn: 1 } },
    )
    expect(seen.at(-1)).toEqual({ text: '你好', done: true })
    expect(seen.every((item) => !/\[expr:/.test(item.text))).toBe(true)
  })

  it('persists the session id through a class settings.update that needs this', async () => {
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

    const { followup, agents } = fakeAgents()
    const settings = new FakeSettings()
    const ctx = createStrictCordisCtx({
      inject: ['agents', 'settings', 'agentDefaultModel', 'agentPresets'],
      values: { agents, settings },
    })
    const send = bindPersonaSend(ctx as CompanionSendContext)
    const result = await send?.('你好')
    expect(result?.sent).toBe(true)
    expect(followup).toHaveBeenCalledTimes(1)
    expect(settings.get('friend-core')).toMatchObject({ companionSessionId: result?.sessionId })
  })

  it('stamps the default model and mounts friend-companion on the standing session', async () => {
    const created: FriendCreateAgentOptions[] = []
    const mounted: Array<[unknown, string]> = []
    const live = new Map<string, FriendAgentHandle>()
    const followup = vi.fn()
    const ctx = createStrictCordisCtx({
      inject: ['agents', 'settings', 'agentDefaultModel', 'agentPresets'],
      values: {
        agents: {
          get(id: string) {
            return live.get(id)
          },
          async create(options: FriendCreateAgentOptions) {
            created.push(options)
            const agent = { id: options.sessionId, followup }
            live.set(agent.id, agent)
            return { agent, dispose: async () => undefined }
          },
        },
        agentDefaultModel: {
          currentSelection: () => ({
            provider: 'opencode-go',
            model: 'deepseek-v4-pro',
            reasoningEffort: 'max',
          }),
        },
        agentPresets: {
          mount: async (agentCtx: unknown, id?: string) => {
            mounted.push([agentCtx, id ?? ''])
          },
        },
      },
    })

    const send = bindPersonaSend(ctx as CompanionSendContext)
    const result = await send?.('你好吗')
    expect(result?.sent).toBe(true)
    expect(created[0]?.agentOptions).toEqual({
      provider: 'opencode-go',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })
    expect(created[0]?.setup).toBeTypeOf('function')
    const agentCtx = { id: 'scoped-agent' }
    await created[0]?.setup?.(agentCtx)
    expect(mounted).toEqual([[agentCtx, 'friend-companion']])
  })

  it('returns undefined when ctx.agents is missing', () => {
    const ctx = createStrictCordisCtx({
      inject: ['agents', 'settings', 'agentDefaultModel', 'agentPresets'],
    })
    expect(bindPersonaSend(ctx as CompanionSendContext)).toBeUndefined()
  })
})
