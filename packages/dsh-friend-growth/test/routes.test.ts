import { describe, expect, it } from 'vitest'

import { createGrowthLlm } from '../src/llm.ts'
import { createGrowthProgressTracker } from '../src/progress.ts'
import { createGrowthRoutes, handleGenerate } from '../src/routes.ts'
import { GrowthStore } from '../src/store.ts'
import { createResponse, route } from './helpers/http.ts'
import { tempDataDir } from './helpers/tmp.ts'

function deps(dataDir: string) {
  const store = new GrowthStore({ dataDir, slug: 'default' })
  const llm = createGrowthLlm({
    resolveDeps: {
      getDefaultModel: () => ({ provider: 'default', model: 'default' }),
      getSettings: () => undefined,
    },
    complete: async (input) => {
      if (input.stage === 'outline') {
        return JSON.stringify({
          events: [{ age: 8, title: '雨夜', summary: '停电的晚上我第一次自己点灯。' }],
        })
      }
      if (input.stage === 'expand') {
        return JSON.stringify({
          beats: [{ age: 8, title: '雨夜', narrative: '巷口的灯灭了，我摸到火柴。', trait_effect: '不怕黑。', importance: 0.8 }],
        })
      }
      return JSON.stringify({
        reflections: [{ title: '独立', narrative: '我只能靠自己。', importance: 0.93 }],
        life_story_summary: '她独自长大。',
      })
    },
  })
  return {
    store,
    llm,
    settings: () => ({ enabled: true, language: '中文', model: undefined }),
    progress: createGrowthProgressTracker(),
    now: () => 1,
  }
}

describe('growth routes', () => {
  it('serves the growth page and rejects the wrong method', async () => {
    const dataDir = await tempDataDir()
    const routes = createGrowthRoutes(deps(dataDir))
    const get = createResponse()
    await route(routes, '/friend/growth').handler({ method: 'GET', url: '/friend/growth' } as never, get as never)
    expect(get.statusCode).toBe(200)
    expect(get.body).toContain('人生故事')
    expect(get.body).toContain('生成')

    const post = createResponse()
    await route(routes, '/friend/growth').handler({ method: 'POST', url: '/friend/growth' } as never, post as never)
    expect(post.statusCode).toBe(405)
  })

  it('pushes a reentrant progress snapshot on SSE connect', async () => {
    const dataDir = await tempDataDir()
    const wired = deps(dataDir)
    wired.progress.set({
      ...wired.progress.snapshot(),
      phase: 'expand',
      percent: 40,
      message: 'expanding',
      batchId: 'b1',
      current: 1,
      total: 3,
      downloadedBytes: 1,
      totalBytes: 3,
      hashPending: false,
    })
    const routes = createGrowthRoutes(wired)
    const response = createResponse()
    route(routes, '/friend/growth/events').handler(
      { method: 'GET', url: '/friend/growth/events', on() {} } as never,
      response as never,
    )
    expect(response.headers['content-type']).toContain('text/event-stream')
    expect(response.body).toContain('event: asset-progress')
    expect(response.body).toContain('expanding')
  })

  it('generate → exclude → commit through HTTP', async () => {
    const dataDir = await tempDataDir()
    const wired = deps(dataDir)
    const routes = createGrowthRoutes(wired)
    const generated = await handleGenerate(wired, { language: '中文' })
    expect(generated.ok).toBe(true)
    expect(generated.beatCount).toBeGreaterThan(0)

    const draft = createResponse()
    await route(routes, '/friend/growth/draft').handler({ method: 'GET', url: '/friend/growth/draft' } as never, draft as never)
    const body = JSON.parse(draft.body) as { beats: Array<{ id: string }> }
    const drop = body.beats[1]?.id
    const keep = body.beats.filter((beat) => beat.id !== drop).map((beat) => beat.id)

    const exclude = createResponse()
    await route(routes, '/friend/growth/exclude').handler({
      method: 'POST',
      url: '/friend/growth/exclude',
      [Symbol.asyncIterator]: async function* () {
        yield JSON.stringify({ ids: drop === undefined ? [] : [drop] })
      },
    } as never, exclude as never)
    expect(exclude.statusCode).toBe(200)

    const commit = createResponse()
    await route(routes, '/friend/growth/commit').handler({
      method: 'POST',
      url: '/friend/growth/commit',
      [Symbol.asyncIterator]: async function* () {
        yield JSON.stringify({ excludedIds: drop === undefined ? [] : [drop] })
      },
    } as never, commit as never)
    expect(commit.statusCode).toBe(200)
    const committed = JSON.parse(commit.body) as { committed: string[] }
    expect(committed.committed).toEqual(keep)
  })
})
