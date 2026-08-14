import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { commitGrowthDraft, renderBeliefsMarkdown, renderStoryMarkdown } from '../src/commit.ts'
import { parseMemoryMarkdown } from '../src/memory-md.ts'
import { lockedAtomicWrite } from '../src/atomic.ts'
import { memoryFilePath } from '../src/paths.ts'
import type { GrowthBeat, GrowthProfile, ParsedBeat, ReflectionResult } from '../src/pure.ts'
import { GrowthStore } from '../src/store.ts'
import { tempDataDir } from './helpers/tmp.ts'

const PROFILE: GrowthProfile = {
  characterId: 'default',
  currentAge: 22,
  birthYear: 2004,
  baseAttributes: '{}',
  worldSetting: '',
  lifeStorySummary: '她独自长大。',
  status: 'drafting',
  language: '中文',
}

function beat(partial: Partial<GrowthBeat> & Pick<GrowthBeat, 'id' | 'kind' | 'title' | 'narrative'>): GrowthBeat {
  const next: GrowthBeat = {
    characterId: 'default',
    batchId: 'b1',
    traitEffect: '',
    importance: 0.7,
    status: 'draft',
    sortOrder: 0,
    ...partial,
  }
  return next
}

async function seedDraft(store: GrowthStore, beats: GrowthBeat[], excluded: string[] = []): Promise<void> {
  const episodes: ParsedBeat[] = beats
    .filter((item) => item.kind !== 'reflection')
    .map((item) => {
      const parsed: ParsedBeat = {
        kind: item.kind,
        title: item.title,
        narrative: item.narrative,
        traitEffect: item.traitEffect,
        importance: item.importance,
      }
      if (item.age !== undefined) {
        parsed.age = item.age
      }
      return parsed
    })
  const reflections: ReflectionResult = {
    reflections: beats.filter((item) => item.kind === 'reflection').map((item) => ({
      kind: 'reflection',
      title: item.title,
      narrative: item.narrative,
      traitEffect: item.traitEffect,
      importance: item.importance,
    })),
    lifeStorySummary: '她独自长大。',
  }
  await store.initBatch({ batchId: 'b1', profile: PROFILE })
  await store.writeOutline('b1', [])
  await store.writeExpandBatch('b1', 0, episodes)
  await store.writeReflect('b1', reflections)
  await store.writeBeats('b1', beats)
  await store.writeExcluded('b1', excluded)
}

describe('commit artefacts', () => {
  it('renders chronological story and bare beliefs (snapshot)', () => {
    const beats = [
      beat({ id: 'e1', kind: 'episode', title: '雨夜', narrative: '我第一次自己点灯。', age: 8, sortOrder: 0 }),
      beat({ id: 'e2', kind: 'episode', title: '离家', narrative: '我提着箱子上了火车。', age: 16, sortOrder: 1 }),
      beat({ id: 'r1', kind: 'reflection', title: '独立', narrative: '我只能靠自己。', sortOrder: 2 }),
    ]
    expect(renderStoryMarkdown(beats, 'b1')).toMatchInlineSnapshot(`
      "# 人生故事

      <!-- growth-batch:b1 -->
      ### 雨夜

      （8岁）我第一次自己点灯。

      ### 离家

      （16岁）我提着箱子上了火车。
      <!-- /growth-batch:b1 -->
      "
    `)
    expect(renderBeliefsMarkdown(beats, 'b1')).toMatchInlineSnapshot(`
      "# 信念

      <!-- growth-batch:b1 -->
      ### 独立

      我只能靠自己。
      <!-- /growth-batch:b1 -->
      "
    `)
  })

  it('writes three files, is idempotent, and leaves other MEMORY sections intact', async () => {
    const dataDir = await tempDataDir()
    const store = new GrowthStore({ dataDir, slug: 'default' })
    const beats = [
      beat({ id: 'e1', kind: 'episode', title: '雨夜', narrative: '我第一次自己点灯。', age: 8 }),
      beat({ id: 'r1', kind: 'reflection', title: '独立', narrative: '我只能靠自己。' }),
    ]
    await seedDraft(store, beats)
    await lockedAtomicWrite(memoryFilePath(dataDir, 'default'), [
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
    ].join('\n'))

    const first = await commitGrowthDraft({ store, batchId: 'b1' })
    const second = await commitGrowthDraft({ store, batchId: 'b1' })
    expect(second.story).toBe(first.story)
    expect(second.beliefs).toBe(first.beliefs)

    const story = await readFile(first.storyPath, 'utf8')
    expect(story.match(/growth-batch:b1/g)).toHaveLength(2)
    expect(story).toContain('（8岁）我第一次自己点灯。')
    expect(story).not.toContain('我只能靠自己。')

    const beliefs = await readFile(first.beliefsPath, 'utf8')
    expect(beliefs).toContain('我只能靠自己。')
    expect(beliefs).not.toContain('（8岁）')

    const memory = parseMemoryMarkdown(await readFile(first.memoryPath, 'utf8'))
    expect(memory.sections['关于用户']).toContain('小陈')
    expect(memory.sections['重要事实']).toContain('香菜')
    expect(memory.sections['待办与约定']).toContain('喝茶')
    expect(memory.sections['近期主题']).toContain('她独自长大。')
    expect(memory.sections['近期主题']).toContain('搬家')
    expect(memory.sections['近期主题'].match(/growth-batch:b1/g)).toHaveLength(2)

    const profile = await store.readProfile()
    expect(profile?.status).toBe('committed')
  })

  it('omits unchecked beats from story.md', async () => {
    const dataDir = await tempDataDir()
    const store = new GrowthStore({ dataDir, slug: 'default' })
    await seedDraft(store, [
      beat({ id: 'keep', kind: 'episode', title: '雨夜', narrative: '留下的节拍。', age: 8 }),
      beat({ id: 'drop', kind: 'episode', title: '琐事', narrative: '被勾除的节拍。', age: 9 }),
    ])
    const result = await commitGrowthDraft({ store, batchId: 'b1', excludedIds: ['drop'] })
    expect(result.story).toContain('留下的节拍')
    expect(result.story).not.toContain('被勾除的节拍')
    expect(result.committed.map((item) => item.id)).toEqual(['keep'])
  })

  it('leaves destination files untouched when rename is interrupted', async () => {
    const dataDir = await tempDataDir()
    const store = new GrowthStore({ dataDir, slug: 'default' })
    await seedDraft(store, [
      beat({ id: 'e1', kind: 'episode', title: '雨夜', narrative: '我走了。', age: 8 }),
    ])
    await expect(commitGrowthDraft({
      store,
      batchId: 'b1',
      hooks: {
        beforeStory: async () => {
          throw new Error('killed')
        },
      },
    })).rejects.toThrow(/killed/)
    await expect(readFile(memoryFilePath(dataDir, 'default'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps an in-flight commit on the start slug when currentSlug flips', async () => {
    const dataDir = await tempDataDir()
    let slug = 'alice'
    const store = new GrowthStore({ dataDir, slug: () => slug })
    await seedDraft(store, [
      beat({ id: 'e1', kind: 'episode', title: '雨夜', narrative: '我第一次自己点灯。', age: 8 }),
    ])

    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = commitGrowthDraft({
      store,
      batchId: 'b1',
      hooks: { beforeStory: () => gate },
    })
    slug = 'bob'
    release()
    const result = await pending

    expect(result.storyPath).toBe(join(dataDir, 'characters/alice/story.md'))
    await expect(readFile(result.storyPath, 'utf8')).resolves.toContain('雨夜')
    await expect(readFile(join(dataDir, 'characters/bob/story.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})
