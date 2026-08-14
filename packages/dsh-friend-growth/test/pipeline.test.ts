import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { CompleteGrowthPrompt } from '../src/llm.ts'
import { createGrowthLlm } from '../src/llm.ts'
import { runGrowthGeneration } from '../src/pipeline.ts'
import { createGrowthProgressTracker } from '../src/progress.ts'
import type { GrowthProfile } from '../src/pure.ts'
import { GrowthStore } from '../src/store.ts'
import { tempDataDir } from './helpers/tmp.ts'

const PROFILE: GrowthProfile = {
  characterId: 'default',
  currentAge: 22,
  birthYear: 2004,
  baseAttributes: '{"kind":"quiet"}',
  worldSetting: '沿海小镇',
  lifeStorySummary: '',
  status: 'drafting',
  language: '中文',
}

function outlineJson(count: number): string {
  const events = Array.from({ length: count }, (_, index) => ({
    age: 6 + index,
    title: `事${index + 1}`,
    summary: `第${index + 1}件具体的事发生在镇上。`,
    node_id: null,
  }))
  return JSON.stringify({ events })
}

function expandJson(ages: readonly number[]): string {
  return JSON.stringify({
    beats: ages.map((age) => ({
      age,
      title: `${age}岁`,
      narrative: `那年我${age}岁，海边的风很大，我把鞋提在手里走回巷口。`,
      trait_effect: '更习惯自己作决定。',
      importance: 0.7,
    })),
  })
}

const REFLECT_JSON = JSON.stringify({
  reflections: [{ title: '独立', narrative: '我只能靠自己。', importance: 0.93 }],
  life_story_summary: '她在海边长大，学会一个人把路走完。',
})

function scriptedLlm(script: {
  outline?: string | (() => string)
  expand?: Array<string | Error>
  reflect?: string
}): { complete: CompleteGrowthPrompt; calls: { outline: number; expand: number; reflect: number } } {
  const calls = { outline: 0, expand: 0, reflect: 0 }
  let expandIndex = 0
  return {
    calls,
    async complete(input) {
      if (input.stage === 'outline') {
        calls.outline += 1
        const raw = typeof script.outline === 'function' ? script.outline() : script.outline
        if (raw === undefined) {
          throw new Error('unexpected outline')
        }
        return raw
      }
      if (input.stage === 'expand') {
        calls.expand += 1
        const next = script.expand?.[expandIndex]
        expandIndex += 1
        if (next instanceof Error) {
          throw next
        }
        if (next === undefined) {
          throw new Error('unexpected expand')
        }
        return next
      }
      calls.reflect += 1
      if (script.reflect === undefined) {
        throw new Error('unexpected reflect')
      }
      return script.reflect
    },
  }
}

function llmOf(complete: CompleteGrowthPrompt) {
  return createGrowthLlm({
    resolveDeps: {
      getDefaultModel: () => ({ provider: 'default', model: 'default' }),
      getSettings: () => undefined,
    },
    complete,
  })
}

describe('three-stage pipeline', () => {
  it('runs outline → expand batches of 4 → reflect with a mocked LLM', async () => {
    const dataDir = await tempDataDir()
    const store = new GrowthStore({ dataDir, slug: 'default' })
    const scripted = scriptedLlm({
      outline: outlineJson(8),
      expand: [expandJson([6, 7, 8, 9]), expandJson([10, 11, 12, 13])],
      reflect: REFLECT_JSON,
    })
    const progress = createGrowthProgressTracker()
    const phases: string[] = []
    progress.subscribe((snapshot) => {
      phases.push(snapshot.phase)
    })

    const result = await runGrowthGeneration({
      store,
      llm: llmOf(scripted.complete),
      batchId: 'b1',
      profile: PROFILE,
      progress,
    })

    expect(scripted.calls).toEqual({ outline: 1, expand: 2, reflect: 1 })
    expect(result.beats.filter((beat) => beat.kind === 'episode')).toHaveLength(8)
    expect(result.beats.some((beat) => beat.kind === 'reflection')).toBe(true)
    expect(result.resumed).toBe(false)
    expect(phases).toContain('outline')
    expect(phases).toContain('expand')
    expect(phases).toContain('reflect')
    expect(phases.at(-1)).toBe('complete')
    const progressFile = await readFile(
      join(dataDir, 'characters/default/growth/b1/progress.json'),
      'utf8',
    )
    expect(progressFile).toContain('"phase": "complete"')
    const profile = await store.readProfile()
    expect(profile?.status).toBe('drafting')
    expect(profile?.lifeStorySummary).toContain('海边')
  })

  it('resumes from the expand watermark and does not redo finished batches', async () => {
    const dataDir = await tempDataDir()
    const store = new GrowthStore({ dataDir, slug: 'default' })
    const first = scriptedLlm({
      outline: outlineJson(5),
      expand: [expandJson([6, 7, 8]), new Error('killed mid-batch')],
    })

    await expect(runGrowthGeneration({
      store,
      llm: llmOf(first.complete),
      batchId: 'b2',
      profile: PROFILE,
    })).rejects.toThrow(/killed mid-batch/)

    expect(first.calls.outline).toBe(1)
    expect(first.calls.expand).toBe(2)
    expect(await store.expandBatchExists('b2', 0)).toBe(true)
    expect(await store.expandBatchExists('b2', 1)).toBe(false)

    const second = scriptedLlm({
      expand: [expandJson([9, 10])],
      reflect: REFLECT_JSON,
    })
    const result = await runGrowthGeneration({
      store,
      llm: llmOf(second.complete),
      batchId: 'b2',
      profile: PROFILE,
    })

    expect(second.calls.outline).toBe(0)
    expect(second.calls.expand).toBe(1)
    expect(second.calls.reflect).toBe(1)
    expect(result.resumed).toBe(true)
    const episodes = result.beats.filter((beat) => beat.kind === 'episode')
    expect(episodes).toHaveLength(5)
    expect(episodes.map((beat) => beat.age)).toEqual([6, 7, 8, 9, 10])
  })

  it('retries a failed batch without duplicating the successful one', async () => {
    const dataDir = await tempDataDir()
    const store = new GrowthStore({ dataDir, slug: 'default' })
    const first = scriptedLlm({
      outline: outlineJson(5),
      expand: [expandJson([6, 7, 8]), new Error('expand-2-failed')],
    })
    await expect(runGrowthGeneration({
      store,
      llm: llmOf(first.complete),
      batchId: 'b3',
      profile: PROFILE,
    })).rejects.toThrow(/expand-2-failed/)

    const second = scriptedLlm({
      expand: [expandJson([9, 10])],
      reflect: REFLECT_JSON,
    })
    const result = await runGrowthGeneration({
      store,
      llm: llmOf(second.complete),
      batchId: 'b3',
      profile: PROFILE,
    })
    const ages = result.beats.filter((beat) => beat.kind === 'episode').map((beat) => beat.age)
    expect(ages).toEqual([6, 7, 8, 9, 10])
    expect(ages.filter((age) => age === 6)).toHaveLength(1)
  })

  it('keeps a generation on the start slug when currentSlug flips mid-outline', async () => {
    const dataDir = await tempDataDir()
    let slug = 'alice'
    const store = new GrowthStore({ dataDir, slug: () => slug })
    const scripted = scriptedLlm({
      outline: () => {
        slug = 'bob'
        return outlineJson(4)
      },
      expand: [expandJson([6, 7, 8, 9])],
      reflect: REFLECT_JSON,
    })

    await runGrowthGeneration({
      store,
      llm: llmOf(scripted.complete),
      batchId: 'b-switch',
      profile: { ...PROFILE, characterId: 'alice' },
    })

    const watermark = await readFile(
      join(dataDir, 'characters/alice/growth/b-switch/watermark.json'),
      'utf8',
    )
    expect(watermark).toContain('"stage": "complete"')
    await expect(readFile(join(dataDir, 'characters/bob/growth/b-switch/watermark.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})
