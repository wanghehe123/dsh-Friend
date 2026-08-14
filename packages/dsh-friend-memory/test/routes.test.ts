import { describe, expect, it } from 'vitest'

import { createMemoryBrowserClient } from '../src/client.ts'
import { createMemoryRoutes } from '../src/routes.ts'
import { FileRetriever } from '../src/retriever.ts'
import { MemoryStore } from '../src/store.ts'
import { tempDataDir } from './helpers/tmp.ts'

type Response = {
  statusCode: number
  headers: Record<string, string>
  body: string
  setHeader: (name: string, value: string) => void
  end: (body?: string) => void
}

function createResponse(): Response {
  const response: Response = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(body = '') {
      this.body = String(body)
    },
  }
  return response
}

async function seeded() {
  const dataDir = await tempDataDir()
  const store = new MemoryStore({
    dataDir,
    slug: 'default',
    now: () => new Date('2026-08-14T12:00:00'),
  })
  await store.appendLongterm('不吃香菜')
  const retriever = new FileRetriever({
    dataDir,
    slug: 'default',
    today: '2026-08-14',
    yesterday: '2026-08-13',
  })
  const routes = createMemoryRoutes({
    store,
    retriever,
    distill: async () => ({ status: 'ok', reason: 'ok' }),
  })
  return { store, routes, retriever }
}

function route(routes: ReturnType<typeof createMemoryRoutes>, path: string) {
  const found = routes.find((item) => item.path === path)
  if (found === undefined) {
    throw new Error(`missing route ${path}`)
  }
  return found
}

describe('memory browser routes', () => {
  it('serves a memory page with tree / search / distill controls', async () => {
    const { routes } = await seeded()
    const response = createResponse()
    await route(routes, '/friend/memory').handler({ method: 'GET', url: '/friend/memory' } as never, response as never)
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('记忆文件')
    expect(response.body).toContain('立即归纳')
    expect(response.body).toContain('/friend/memory/search')
    expect(response.body).toContain('/friend/memory/distill')
  })

  it('saves an edit and reads it back (no cache)', async () => {
    const { routes, store } = await seeded()
    const path = `characters/default/MEMORY.md`
    const put = createResponse()
    const request = {
      method: 'PUT',
      url: '/friend/memory/file',
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify({
          path,
          text: '## 关于用户\n\n- 手改\n\n## 重要事实\n\n## 近期主题\n\n## 待办与约定\n',
        })
      },
    }
    await route(routes, '/friend/memory/file').handler(request as never, put as never)
    expect(put.statusCode).toBe(200)
    expect(await store.readMemoryRaw()).toContain('手改')

    const get = createResponse()
    await route(routes, '/friend/memory/file').handler(
      { method: 'GET', url: `/friend/memory/file?path=${encodeURIComponent(path)}` } as never,
      get as never,
    )
    expect(JSON.parse(get.body).text).toContain('手改')
  })

  it('search results match the retriever used by memory_search', async () => {
    const { routes, retriever } = await seeded()
    const expected = await retriever.search('香菜')
    const response = createResponse()
    await route(routes, '/friend/memory/search').handler(
      { method: 'GET', url: '/friend/memory/search?q=%E9%A6%99%E8%8F%9C' } as never,
      response as never,
    )
    const body = JSON.parse(response.body) as { hits: typeof expected; rendered: string }
    expect(body.hits).toEqual(expected)
    expect(body.rendered).toContain('香菜')
  })
})

describe('memory browser client', () => {
  it('round-trips save and search through the host routes', async () => {
    const { routes } = await seeded()
    const client = createMemoryBrowserClient(async (input, init) => {
      const url = new URL(input, 'http://127.0.0.1')
      const found = routes.find((item) => item.path === url.pathname)
      if (found === undefined) {
        return { ok: false, json: async () => ({}) }
      }
      const response = createResponse()
      const request = {
        method: init?.method ?? 'GET',
        url: url.pathname + url.search,
        async *[Symbol.asyncIterator]() {
          if (init?.body !== undefined) {
            yield init.body
          }
        },
      }
      await found.handler(request as never, response as never)
      return {
        ok: response.statusCode < 400,
        json: async () => JSON.parse(response.body) as unknown,
      }
    })

    const files = await client.listTree()
    expect(files.some((file) => file.endsWith('MEMORY.md'))).toBe(true)
    const path = files.find((file) => file.endsWith('MEMORY.md'))
    if (path === undefined) {
      throw new Error('MEMORY.md missing from tree')
    }
    await client.writeFile(path, '## 关于用户\n\n- 客户端保存\n\n## 重要事实\n\n## 近期主题\n\n## 待办与约定\n')
    expect(await client.readFile(path)).toContain('客户端保存')
    const hits = await client.search('客户端')
    expect(hits[0]?.snippet).toContain('客户端保存')
  })
})
