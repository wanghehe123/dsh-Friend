import { describe, expect, it, vi } from 'vitest'

import { createStrictCordisCtx } from '../src/strict-cordis-ctx.ts'
import {
  buildFriendGenerateOptions,
  completeViaLlmStream,
  readDefaultModelSelection,
  requireLlmRoute,
  requireLlmRuntime,
  streamLlm,
  type FriendGenerateOptions,
  type FriendLlmRuntime,
  type FriendStreamChunk,
} from '../src/compat/llm.ts'

function llmWithStream(
  stream: FriendLlmRuntime['stream'],
): FriendLlmRuntime {
  return {
    listProviders: () => [{ id: 'deepseek' }],
    stream,
  }
}

describe('readDefaultModelSelection', () => {
  it('forwards currentSelection without destructuring', () => {
    const currentSelection = vi.fn(() => ({ provider: 'deepseek', model: 'deepseek-chat' }))
    const ctx = createStrictCordisCtx({
      inject: ['agentDefaultModel'],
      values: { agentDefaultModel: { currentSelection } },
    })
    expect(readDefaultModelSelection({
      agentDefaultModel: ctx.agentDefaultModel as { currentSelection(): { provider: string; model: string } },
    })).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(currentSelection).toHaveBeenCalledOnce()
  })
})

describe('requireLlmRuntime / requireLlmRoute', () => {
  it('fail-louds when ctx.llm is missing — not a live-model refusal', () => {
    expect(() => requireLlmRuntime(undefined, 'dsh-friend-memory')).toThrow(
      /ctx\.llm is missing; cannot call LlmRuntime\.stream/,
    )
    expect(() => requireLlmRuntime(undefined, 'dsh-friend-memory')).not.toThrow(
      /completePrompt seam|refusing to call a live model/,
    )
  })

  it('rejects openai-compat overrides that have no adapter route', () => {
    expect(() => requireLlmRoute({
      kind: 'openai-compat',
      baseURL: 'https://example.test/v1',
      model: 'x',
    }, 'dsh-friend-growth')).toThrow(/openai-compat override is not dispatched through ctx\.llm\.stream/)
  })

  it('accepts a registered route', () => {
    expect(requireLlmRoute({
      kind: 'registered',
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
    }, 'dsh-friend-memory')).toEqual({
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
    })
  })
})

describe('buildFriendGenerateOptions', () => {
  it('maps system + user onto official GenerateOptions fields', () => {
    const options = buildFriendGenerateOptions({
      route: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
      system: 'sys',
      user: 'hello',
      temperature: 0.7,
    })
    expect(options.provider).toBe('deepseek')
    expect(options.model).toBe('deepseek-chat')
    expect(options.reasoningEffort).toBe('high')
    expect(options.system).toBe('sys')
    expect(options.temperature).toBe(0.7)
    expect(options.messages).toHaveLength(1)
    expect(options.messages[0]?.role).toBe('user')
    expect(options.messages[0]?.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(options.messages[0]?.source).toEqual({ kind: 'user' })
  })
})

describe('completeViaLlmStream', () => {
  it('calls llm.stream(options) with this intact and concatenates text-delta', async () => {
    const seen: FriendGenerateOptions[] = []
    const runtime = llmWithStream(async function* stream(this: FriendLlmRuntime, options) {
      seen.push(options)
      expect(this).toBe(runtime)
      const hello: FriendStreamChunk = { type: 'text-delta', index: 0, text: 'hello' }
      const world: FriendStreamChunk = { type: 'text-delta', index: 0, text: ' world' }
      const done: FriendStreamChunk = { type: 'finish', reason: { kind: 'stop' } }
      yield hello
      yield world
      yield done
    })
    const options = buildFriendGenerateOptions({
      route: { provider: 'deepseek', model: 'deepseek-chat' },
      system: 'sys',
      user: 'hi',
    })
    await expect(completeViaLlmStream(runtime, options)).resolves.toBe('hello world')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ provider: 'deepseek', model: 'deepseek-chat', system: 'sys' })
  })

  it('falls back to block-end text when the adapter emitted no deltas', async () => {
    const runtime = llmWithStream(async function* stream() {
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'assembled' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    await expect(completeViaLlmStream(runtime, {
      provider: 'p',
      model: 'm',
      messages: [],
    })).resolves.toBe('assembled')
  })

  it('throws a dsh-llm-prefixed error on finish error/aborted — not a Friend stub', async () => {
    const runtime = llmWithStream(async function* stream() {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'AUTH', message: 'API key is missing' } },
      }
    })
    await expect(completeViaLlmStream(runtime, {
      provider: 'p',
      model: 'm',
      messages: [],
    })).rejects.toThrow(/dsh-llm AUTH: API key is missing/)
  })

  it('streamLlm does not destructure the method (Proxy this-guard)', async () => {
    const ctx = createStrictCordisCtx({
      inject: ['llm'],
      values: {
        llm: llmWithStream(async function* stream() {
          yield { type: 'text-delta', index: 0, text: 'ok' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }),
      },
    })
    const llm = ctx.llm as FriendLlmRuntime
    const chunks: FriendStreamChunk[] = []
    for await (const chunk of streamLlm(llm, { provider: 'p', model: 'm', messages: [] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toMatchObject({ type: 'text-delta', text: 'ok' })
    const { stream } = llm
    expect(() => stream({ provider: 'p', model: 'm', messages: [] })).toThrow(/receiver was lost/)
  })
})
