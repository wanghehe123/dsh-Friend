import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { apply } from '../src/index.ts'
import { applyBootstrapBudget, formatMemorySection, MEMORY_SECTION_NAME } from '../src/sections.ts'
import { MemoryStore } from '../src/store.ts'
import { MockPromptPipeline } from './helpers/prompt-pipeline.ts'
import { tempDataDir } from './helpers/tmp.ts'

describe('memory bootstrap section', () => {
  it('renders MEMORY.md + USER.md + today/yesterday notes', async () => {
    const dataDir = await tempDataDir()
    const store = new MemoryStore({
      dataDir,
      slug: 'default',
      now: () => new Date('2026-08-14T12:00:00'),
    })
    await store.appendLongterm('不吃香菜')
    await store.appendDaily({ text: '今天买了茶', source: 'note', date: '2026-08-14' })
    await store.appendDaily({ text: '昨天约了周日', source: 'chat', date: '2026-08-13' })
    await store.writeUser('# 用户\n\n- 名字：小陈\n')

    const text = formatMemorySection({
      memory: await store.readMemoryRaw(),
      today: await store.readDailyRaw('2026-08-14'),
      yesterday: await store.readDailyRaw('2026-08-13'),
      user: await store.readUserRaw(),
    })

    expect(text).toMatchSnapshot()
    expect(text).toContain('不吃香菜')
    expect(text).toContain('今天买了茶')
    expect(text).toContain('昨天约了周日')
    expect(text).toContain('小陈')
  })

  it('uses placeholders when files are missing', () => {
    const text = formatMemorySection({ memory: '', today: '', yesterday: '', user: '' })
    expect(text).toContain('尚无长期记忆')
    expect(text).toContain('尚无用户画像')
    expect(text).toContain('今日尚无笔记')
    expect(text).toContain('昨日尚无笔记')
  })

  it('keeps MEMORY.md and truncates older notes first when over budget', () => {
    const bundle = {
      memory: 'MEMORY-CORE',
      user: 'USER-CORE',
      today: 'TODAY-' + '今'.repeat(200),
      yesterday: 'YESTERDAY-' + '昨'.repeat(200),
    }
    const clipped = applyBootstrapBudget(bundle, 400)
    expect(clipped.memory).toContain('MEMORY-CORE')
    expect(clipped.yesterday.length).toBeLessThan(bundle.yesterday.length)
  })
})

describe('memory section scope', () => {
  it('does not leak into a coding-session assemble', async () => {
    const dataDir = await tempDataDir()
    const pipeline = new MockPromptPipeline()
    await apply(
      {
        webServer: { register: () => () => undefined },
        effect: (execute) => execute(),
        systemPrompt: pipeline.context().systemPrompt,
        tools: { register: () => () => undefined, restrict: () => () => undefined },
      },
      { role: 'host', dataDir, env: {}, completePrompt: async () => '[]' },
    )
    await apply(
      {
        systemPrompt: pipeline.context('friend-companion').systemPrompt,
        tools: { register: () => () => undefined, restrict: () => () => undefined },
      },
      { role: 'companion-preset', dataDir, env: {}, completePrompt: async () => '[]' },
    )

    expect(pipeline.assemble('standard').names).toEqual([])
    expect(pipeline.assemble('standard').text).not.toContain('# 记忆')
    expect(pipeline.assemble('friend-companion').names).toEqual([MEMORY_SECTION_NAME])
  })

  it('rereads yesterday notes on the next assemble after an external edit', async () => {
    const dataDir = await tempDataDir()
    const pipeline = new MockPromptPipeline()
    const notePath = join(dataDir, 'characters/default/memory/2026-08-13.md')
    await mkdir(join(dataDir, 'characters/default/memory'), { recursive: true })
    await writeFile(notePath, '- 09:00 [note] 旧昨日\n', 'utf8')

    const { registerMemorySection } = await import('../src/sections.ts')
    const { readBootstrapSync } = await import('../src/retriever.ts')
    registerMemorySection(pipeline.context('friend-companion'), {
      load: () => readBootstrapSync({
        dataDir,
        slug: 'default',
        today: '2026-08-14',
        yesterday: '2026-08-13',
      }),
    })

    expect(pipeline.assemble('friend-companion').text).toContain('旧昨日')
    await writeFile(notePath, '- 09:00 [note] 手改昨日约定\n', 'utf8')
    expect(pipeline.assemble('friend-companion').text).toContain('手改昨日约定')
    expect(pipeline.assemble('friend-companion').text).not.toContain('旧昨日')
  })
})
