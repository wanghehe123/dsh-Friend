import { describe, expect, it } from 'vitest'

import type { FriendLlmRuntime, FriendStreamChunk } from '@wish233/dsh-friend-shared'
import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared'

import { pingFriendModel } from '../src/host-models.ts'

function llmWithStream(
  stream: FriendLlmRuntime['stream'],
): FriendLlmRuntime {
  return {
    listProviders: () => [{ id: 'deepseek' }],
    stream,
  }
}

describe('pingFriendModel', () => {
  it('streams a ping through ctx.llm and reports the resolved route', async () => {
    const seen: Array<{ provider?: string; model?: string }> = []
    const result = await pingFriendModel({
      purpose: 'chat',
      override: '',
      models: {
        getDefaultModel: () => ({ provider: 'opencode-go', model: 'deepseek-v4-pro' }),
        getSettings: () => ({}),
      },
      llm: llmWithStream(async function* stream(options) {
        seen.push({ provider: options.provider, model: options.model })
        const delta: FriendStreamChunk = { type: 'text-delta', index: 0, text: 'pong' }
        const done: FriendStreamChunk = { type: 'finish', reason: { kind: 'stop' } }
        yield delta
        yield done
      }),
    })
    expect(seen).toEqual([{ provider: 'opencode-go', model: 'deepseek-v4-pro' }])
    expect(result).toEqual({
      ok: true,
      detail: 'opencode-go/deepseek-v4-pro · pong',
    })
  })

  it('applies a draft override without writing settings', async () => {
    const reads: string[] = []
    const result = await pingFriendModel({
      purpose: 'chat',
      override: 'deepseek-chat',
      models: {
        getDefaultModel: () => ({ provider: 'deepseek', model: 'deepseek-reasoner' }),
        getSettings: (namespace) => {
          reads.push(namespace)
          return { chatModel: 'should-not-win' }
        },
      },
      llm: llmWithStream(async function* stream(options) {
        const delta: FriendStreamChunk = { type: 'text-delta', index: 0, text: 'ok' }
        yield delta
        yield { type: 'finish', reason: { kind: 'stop' } }
        expect(options.model).toBe('deepseek-chat')
      }),
    })
    expect(reads).toContain(FRIEND_SETTINGS_NAMESPACES.persona)
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('deepseek/deepseek-chat')
  })

  it('fails closed when the runtime is missing or the finish chunk errors', async () => {
    const missing = await pingFriendModel({
      purpose: 'summarize',
      override: '',
      models: {
        getDefaultModel: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
        getSettings: () => ({}),
      },
    })
    expect(missing).toEqual({ ok: false, detail: 'llm runtime unavailable' })

    const failed = await pingFriendModel({
      purpose: 'chat',
      override: '',
      models: {
        getDefaultModel: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
        getSettings: () => ({}),
      },
      llm: llmWithStream(async function* stream() {
        yield {
          type: 'finish',
          reason: { kind: 'error', failure: { code: 'AUTH', message: 'API key is missing' } },
        }
      }),
    })
    expect(failed.ok).toBe(false)
    expect(failed.detail).toMatch(/dsh-llm AUTH: API key is missing/)
  })

  it('treats a reasoning-only finish as connected instead of empty reply', async () => {
    const result = await pingFriendModel({
      purpose: 'chat',
      override: '',
      models: {
        getDefaultModel: () => ({ provider: 'opencode-go', model: 'deepseek-v4-pro' }),
        getSettings: () => ({}),
      },
      llm: llmWithStream(async function* stream() {
        const thinking: FriendStreamChunk = { type: 'reasoning-delta', index: 0, text: 'ping then pong' }
        yield thinking
        yield { type: 'finish', reason: { kind: 'stop' } }
      }),
    })
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('opencode-go/deepseek-v4-pro')
    expect(result.detail).toContain('已连通')
    expect(result.detail).not.toContain('empty reply')
  })

  it('does not pretend an openai-compat override succeeded', async () => {
    const result = await pingFriendModel({
      purpose: 'growth',
      override: '',
      models: {
        getDefaultModel: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
        getSettings: (namespace) => {
          if (namespace === FRIEND_SETTINGS_NAMESPACES.growth) {
            return { model: { baseURL: 'https://api.example.test/v1', model: 'local-llm' } }
          }
          return {}
        },
      },
      llm: llmWithStream(async function* stream() {
        throw new Error('should not stream openai-compat')
      }),
    })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('https://api.example.test/v1')
    expect(result.detail).toContain('ctx.llm')
  })
})
