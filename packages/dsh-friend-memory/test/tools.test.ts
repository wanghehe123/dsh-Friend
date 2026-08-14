import type { ToolDefinition } from '@wishp3/dsh-friend-shared'
import { describe, expect, it } from 'vitest'

import { apply, name } from '../src/index.ts'
import { FileRetriever } from '../src/retriever.ts'
import { MemoryStore } from '../src/store.ts'
import { createMemoryTools, MEMORY_TOOL_NAMES } from '../src/tools.ts'
import { MockToolPipeline } from './helpers/tool-pipeline.ts'
import { tempDataDir } from './helpers/tmp.ts'

function callTool(tool: ToolDefinition, args: unknown) {
  return tool.execute(args, {
    signal: new AbortController().signal,
    deferContext: () => undefined,
    concludeTurn: () => undefined,
  } as Parameters<ToolDefinition['execute']>[1])
}

function toolNamed(tools: readonly ToolDefinition[], toolName: string): ToolDefinition {
  const found = tools.find((tool) => tool.name === toolName)
  if (found === undefined) {
    throw new Error(`missing tool ${toolName}`)
  }
  return found
}

async function toolsAt(dataDir: string) {
  const store = new MemoryStore({
    dataDir,
    slug: 'default',
    now: () => new Date('2026-08-14T15:04:00'),
  })
  const retriever = new FileRetriever({
    dataDir,
    slug: 'default',
    today: '2026-08-14',
    yesterday: '2026-08-13',
  })
  return { store, tools: createMemoryTools({ store, retriever }) }
}

describe('memory tool names align with the persona allowlist contract', () => {
  it('registers exactly memory_append / memory_search / memory_get', () => {
    expect(MEMORY_TOOL_NAMES).toEqual(['memory_append', 'memory_search', 'memory_get'])
  })
})

describe('memory_append / memory_get', () => {
  it('writes daily notes with [note] and longterm facts into 重要事实', async () => {
    const { store, tools } = await toolsAt(await tempDataDir())
    await expect(callTool(toolNamed(tools, 'memory_append'), {
      text: '不吃香菜',
      target: 'daily',
    })).resolves.toMatchObject({ ok: true, target: 'daily' })
    await expect(store.readDailyRaw('2026-08-14')).resolves.toMatch(/- 15:04 \[note\] 不吃香菜/)

    await expect(callTool(toolNamed(tools, 'memory_append'), {
      text: '周日喝茶',
      target: 'longterm',
    })).resolves.toMatchObject({ ok: true, target: 'longterm', path: 'MEMORY.md' })
    const memory = await store.readMemory()
    expect(memory.sections['重要事实']).toContain('周日喝茶')
  })

  it('rejects a path outside the friend data directory', async () => {
    const { tools } = await toolsAt(await tempDataDir())
    const get = toolNamed(tools, 'memory_get')
    await expect(callTool(get, { path: '../../etc/passwd' })).resolves.toMatchObject({
      ok: false,
    })
    await expect(callTool(get, { path: '/etc/passwd' })).resolves.toMatchObject({
      ok: false,
    })
    await expect(callTool(get, { path: 'characters/default/persona.json' })).resolves.toMatchObject({
      ok: false,
    })
  })

  it('search then get recalls a daily note', async () => {
    const { store, tools } = await toolsAt(await tempDataDir())
    await store.appendDaily({ text: '不吃香菜', source: 'note' })
    const hits = await callTool(toolNamed(tools, 'memory_search'), { query: '香菜' }) as {
      hits: Array<{ path: string; line: number }>
    }
    expect(hits.hits[0]?.path).toContain('2026-08-14.md')
    const got = await callTool(toolNamed(tools, 'memory_get'), {
      path: hits.hits[0]?.path,
      from: hits.hits[0]?.line,
      to: hits.hits[0]?.line,
    }) as { text: string }
    expect(got.text).toContain('不吃香菜')
  })
})

describe('memory tools are companion-preset scoped', () => {
  it('does not register tools on host apply', async () => {
    const pipeline = new MockToolPipeline()
    const dataDir = await tempDataDir()
    await apply(
      {
        webServer: { register: () => () => undefined },
        effect: (execute) => execute(),
        tools: pipeline.context().tools,
        systemPrompt: { section: () => () => undefined },
      },
      { role: 'host', dataDir, env: {}, completePrompt: async () => '[]' },
    )
    expect(name).toBe('@wishp3/dsh-friend-memory')
    expect(pipeline.visible()).toEqual([])
  })

  it('registers the three tools only on the companion standing-mount scope', async () => {
    const pipeline = new MockToolPipeline()
    const dataDir = await tempDataDir()
    await apply(
      {
        tools: pipeline.context().tools,
        systemPrompt: { section: () => () => undefined },
      },
      { role: 'host', dataDir, env: {}, completePrompt: async () => '[]' },
    )
    await apply(
      {
        tools: pipeline.context('friend-companion').tools,
        systemPrompt: { section: () => () => undefined },
      },
      { role: 'companion-preset', dataDir, env: {}, completePrompt: async () => '[]' },
    )
    expect(pipeline.visible()).toEqual([])
    expect(pipeline.visible('friend-companion')).toEqual([
      'memory_append',
      'memory_search',
      'memory_get',
    ])
  })
})
