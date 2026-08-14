import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createFriendSettingsInstallProbe,
  createStrictCordisCtx,
  FRIEND_SETTINGS_NAMESPACES,
} from '@wishp3/dsh-friend-shared'

import { apply, applyMemory, inject, name, type FriendMemoryContext } from '../src/index.ts'
import { MEMORY_SECTION_NAME } from '../src/sections.ts'
import { MockPromptPipeline } from './helpers/prompt-pipeline.ts'
import { MockToolPipeline } from './helpers/tool-pipeline.ts'
import { tempDataDir } from './helpers/tmp.ts'

describe('cordis inject', () => {
  it('declares the services apply() may read', () => {
    expect(inject).toEqual(['webServer', 'tools', 'systemPrompt', 'settings', 'agentDefaultModel', 'llm'])
    expect(name).toBe('@wishp3/dsh-friend-memory')
  })
})

describe('apply() role split', () => {
  it('registers friend-memory on the production host path', async () => {
    const dataDir = await tempDataDir()
    const probe = createFriendSettingsInstallProbe()
    const handle = await applyMemory(
      {
        ...probe,
        webServer: {
          register() {
            return () => undefined
          },
        },
        effect: (execute) => execute(),
      },
      { role: 'host', dataDir, env: {}, completePrompt: async () => '[]' },
    )
    expect(probe.registered.map((item) => item.ns)).toEqual([FRIEND_SETTINGS_NAMESPACES.memory])
    handle.dispose()
  })

  it('host apply mounts routes and does not register tools or the memory section', async () => {
    const dataDir = await tempDataDir()
    const pipeline = new MockPromptPipeline()
    const tools = new MockToolPipeline()
    const routes: Array<{ path: string }> = []

    const handle = await applyMemory(
      {
        webServer: {
          register(route) {
            routes.push(route)
            return () => undefined
          },
        },
        effect: (execute) => execute(),
        systemPrompt: pipeline.context().systemPrompt,
        tools: tools.context().tools,
      },
      { role: 'host', dataDir, env: {}, completePrompt: async () => '[]' },
    )

    expect(handle.role).toBe('host')
    expect(tools.visible()).toEqual([])
    expect(pipeline.assemble().names).toEqual([])
    expect(routes.some((route) => route.path === '/friend/memory')).toBe(true)
    expect(routes.some((route) => route.path === '/friend/memory/search')).toBe(true)
    expect(routes.some((route) => route.path === '/friend/memory/distill')).toBe(true)
    handle.dispose()
  })

  it('companion-preset apply registers tools + section and no routes', async () => {
    const dataDir = await tempDataDir()
    const pipeline = new MockPromptPipeline()
    const tools = new MockToolPipeline()
    const routes: Array<{ path: string }> = []

    await apply(
      {
        webServer: {
          register(route) {
            routes.push(route)
            return () => undefined
          },
        },
        effect: (execute) => execute(),
        systemPrompt: pipeline.context('friend-companion').systemPrompt,
        tools: tools.context('friend-companion').tools,
      },
      { role: 'companion-preset', dataDir, env: {}, completePrompt: async () => '[]' },
    )

    expect(routes).toEqual([])
    expect(tools.visible('friend-companion')).toEqual([
      'memory_append',
      'memory_search',
      'memory_get',
    ])
    expect(pipeline.assemble('friend-companion').names).toEqual([MEMORY_SECTION_NAME])
  })

  it('fail-louds when companion-preset apply() has no tools service', async () => {
    await expect(apply({}, { role: 'companion-preset', dataDir: await tempDataDir(), env: {} }))
      .rejects.toThrow(/ctx\.tools/)
  })

  it('re-reads persona currentSlug and memoryMaxBytes after apply()', async () => {
    const dataDir = await tempDataDir()
    const bag: Record<string, Record<string, unknown>> = {
      [FRIEND_SETTINGS_NAMESPACES.persona]: { currentSlug: 'alice' },
      [FRIEND_SETTINGS_NAMESPACES.memory]: { memoryMaxBytes: 4 * 1024 },
    }
    const handle = await applyMemory(
      {
        settings: {
          get(namespace) {
            return bag[namespace]
          },
        },
      },
      { role: 'host', dataDir, env: {}, completePrompt: async () => '[]' },
    )
    expect(handle.store.slug).toBe('alice')
    expect(handle.store.memoryMaxBytes).toBe(4 * 1024)
    await handle.store.appendLongterm('alice-only')

    bag[FRIEND_SETTINGS_NAMESPACES.persona] = { currentSlug: 'bob' }
    bag[FRIEND_SETTINGS_NAMESPACES.memory] = { memoryMaxBytes: 16 * 1024 }
    expect(handle.store.slug).toBe('bob')
    expect(handle.store.memoryMaxBytes).toBe(16 * 1024)
    await handle.store.appendLongterm('bob-only')

    const alice = await readFile(join(dataDir, 'characters/alice/MEMORY.md'), 'utf8')
    const bob = await readFile(join(dataDir, 'characters/bob/MEMORY.md'), 'utf8')
    expect(alice).toContain('alice-only')
    expect(alice).not.toContain('bob-only')
    expect(bob).toContain('bob-only')
    expect(bob).not.toContain('alice-only')
    handle.dispose()
  })
})

const DISTILL_MARKDOWN = [
  '## 关于用户',
  '',
  '- 叫小陈',
  '',
  '## 重要事实',
  '',
  '- 不吃香菜',
  '',
  '## 近期主题',
  '',
  '- 搬家',
  '',
  '## 待办与约定',
  '',
  '- 周日喝茶',
  '',
].join('\n')

function hostCtx(values: Record<string, unknown> = {}): FriendMemoryContext {
  return createStrictCordisCtx({
    inject,
    values: {
      effect: (execute: () => () => void) => execute(),
      ...values,
    },
  }) as FriendMemoryContext
}

describe('host production LLM path', () => {
  it('default completePrompt calls ctx.llm.stream() and does not hit the old stub', async () => {
    const dataDir = await tempDataDir()
    const seen: unknown[] = []
    const llm = {
      listProviders: () => [{ id: 'deepseek' }],
      async *stream(options: unknown) {
        seen.push(options)
        yield { type: 'text-delta', index: 0, text: DISTILL_MARKDOWN }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const handle = await applyMemory(
      hostCtx({
        llm,
        agentDefaultModel: {
          currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
        },
      }),
      { role: 'host', dataDir, env: {} },
    )
    const result = await handle.runDistill()
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    expect(result).toMatchObject({ status: 'ok' })
    expect(JSON.stringify(result)).not.toMatch(/completePrompt seam|refusing to call a live model/)
    handle.dispose()
  })

  it('missing ctx.llm is a service-missing error, not the live-model refusal stub', async () => {
    const dataDir = await tempDataDir()
    const handle = await applyMemory(hostCtx(), { role: 'host', dataDir, env: {} })
    const result = await handle.runDistill()
    expect(result.status).toBe('rolled-back')
    expect(String((result as { reason?: string }).reason)).toMatch(
      /ctx\.llm is missing; cannot call LlmRuntime\.stream/,
    )
    expect(String((result as { reason?: string }).reason)).not.toMatch(
      /completePrompt seam|refusing to call a live model/,
    )
    handle.dispose()
  })

  it('subscribes to session/event turn/end and drives auto-summary', async () => {
    const dataDir = await tempDataDir()
    const listeners: Array<(...args: unknown[]) => void> = []
    const llm = {
      listProviders: () => [{ id: 'deepseek' }],
      async *stream() {
        yield { type: 'text-delta', index: 0, text: '[{"fact":"用户不吃香菜"}]' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const ctx = createStrictCordisCtx({
      inject: [...inject, 'on'],
      values: {
        effect: (execute: () => () => void) => execute(),
        llm,
        agentDefaultModel: {
          currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
        },
        on(event: string, handler: (...args: unknown[]) => void) {
          expect(event).toBe('session/event')
          listeners.push(handler)
          return () => undefined
        },
      },
    }) as FriendMemoryContext
    const handle = await applyMemory(ctx, { role: 'host', dataDir, env: {} })
    expect(listeners).toHaveLength(1)
    listeners[0]?.(
      {
        id: 'friend-companion-1',
        header: { agentPreset: 'friend-companion' },
        events: [
          { type: 'turn/start', data: { turn: 1 } },
          {
            type: 'user/message',
            data: { role: 'user', content: [{ type: 'text', text: '记住我不吃香菜' }] },
          },
          {
            type: 'assistant/message',
            data: { message: { role: 'assistant', content: [{ type: 'text', text: '好' }] } },
          },
          { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
        ],
      },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    )
    await handle.autoSummary?.flush()
    expect(await handle.store.readDailyRaw()).toMatch(/\[chat\] 用户不吃香菜/)
    handle.dispose()
  })

  it('registers host timers/subscriptions on ctx.effect so reload disposes them', async () => {
    const dataDir = await tempDataDir()
    const labels: string[] = []
    let effectDispose: (() => void) | undefined
    const ctx = hostCtx({
      effect(execute: () => () => void, label?: string) {
        if (label !== undefined) {
          labels.push(label)
        }
        const dispose = execute()
        if (label === 'dsh-friend-memory:host') {
          effectDispose = dispose
        }
        return dispose
      },
    })
    const handle = await applyMemory(ctx, { role: 'host', dataDir, env: {} })
    expect(labels).toContain('dsh-friend-memory:host')
    expect(effectDispose).toBeTypeOf('function')
    effectDispose?.()
    handle.dispose()
  })
})
