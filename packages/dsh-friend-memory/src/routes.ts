import type { IncomingMessage, ServerResponse } from 'node:http'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { registerRoute, type FriendRouteContext } from '@wish233/dsh-friend-shared'

import { renderMemoryBrowserPage, renderSearchHits } from './browser-page.ts'
import type { DistillResult } from './distill.ts'
import { dailyDir, memoryFilePath, storyFilePath, userFilePath } from './paths.ts'
import type { MemoryRetriever } from './retriever.ts'
import type { MemoryStore } from './store.ts'
import { MemoryPathError, resolveMemoryPath, toDataRel } from './whitelist.ts'

export type MemoryRouteDeps = {
  store: MemoryStore
  retriever: MemoryRetriever
  distill: () => Promise<DistillResult>
  importKokoro?: (from: string) => Promise<unknown>
}

export function createMemoryRoutes(deps: MemoryRouteDeps): readonly WebRoute[] {
  const dataDir = deps.store.dataDir

  return [
    {
      kind: 'exact',
      path: '/friend/memory',
      async handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        writeHtml(response, renderMemoryBrowserPage())
      },
    },
    {
      kind: 'exact',
      path: '/friend/memory/tree',
      async handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        writeJson(response, { files: await listMemoryTree(deps.store) })
      },
    },
    {
      kind: 'exact',
      path: '/friend/memory/file',
      async handler(request, response) {
        if (isGet(request)) {
          const path = queryParam(request, 'path')
          if (path === undefined) {
            return writeJson(response, { ok: false, error: 'path is required' }, 400)
          }
          try {
            const absolute = resolveMemoryPath(dataDir, path)
            const text = await readFile(absolute, 'utf8')
            return writeJson(response, { ok: true, path, text })
          } catch (error) {
            const status = error instanceof MemoryPathError ? 403 : 404
            return writeJson(response, { ok: false, error: cause(error) }, status)
          }
        }
        if (request.method !== 'PUT') {
          return writeText(response, 'Method Not Allowed', 405)
        }
        try {
          const body = await readJson(request) as { path?: unknown; text?: unknown }
          if (typeof body.path !== 'string' || typeof body.text !== 'string') {
            return writeJson(response, { ok: false, error: 'path and text are required' }, 400)
          }
          const absolute = resolveMemoryPath(dataDir, body.path)
          const { lockedAtomicWrite } = await import('./atomic.ts')
          await lockedAtomicWrite(absolute, body.text)
          return writeJson(response, { ok: true, path: body.path })
        } catch (error) {
          const status = error instanceof MemoryPathError ? 403 : 400
          return writeJson(response, { ok: false, error: cause(error) }, status)
        }
      },
    },
    {
      kind: 'exact',
      path: '/friend/memory/search',
      async handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        const query = queryParam(request, 'q') ?? ''
        const hits = await deps.retriever.search(query)
        writeJson(response, { ok: true, hits, rendered: renderSearchHits(hits) })
      },
    },
    {
      kind: 'exact',
      path: '/friend/memory/distill',
      async handler(request, response) {
        if (request.method !== 'POST') {
          return writeText(response, 'Method Not Allowed', 405)
        }
        const result = await deps.distill()
        writeJson(response, result, result.status === 'ok' ? 200 : 409)
      },
    },
    {
      kind: 'exact',
      path: '/friend/memory/import',
      async handler(request, response) {
        if (request.method !== 'POST') {
          return writeText(response, 'Method Not Allowed', 405)
        }
        if (deps.importKokoro === undefined) {
          return writeJson(response, { ok: false, error: 'importer is not wired' }, 501)
        }
        try {
          const body = await readJson(request) as { from?: unknown }
          if (typeof body.from !== 'string' || body.from.trim().length === 0) {
            return writeJson(response, { ok: false, error: 'from is required' }, 400)
          }
          const report = await deps.importKokoro(body.from)
          return writeJson(response, { ok: true, report })
        } catch (error) {
          return writeJson(response, { ok: false, error: cause(error) }, 400)
        }
      },
    },
  ]
}

export function registerMemoryRoutes(ctx: FriendRouteContext, deps: MemoryRouteDeps): void {
  for (const route of createMemoryRoutes(deps)) {
    registerRoute(ctx, route)
  }
}

export async function listMemoryTree(store: MemoryStore): Promise<string[]> {
  return store.runWithCapturedDir(async () => {
    const slug = store.slug
    const files: string[] = []
    await pushExisting(files, store.dataDir, memoryFilePath(store.dataDir, slug))
    await pushExisting(files, store.dataDir, userFilePath(store.dataDir))
    await pushExisting(files, store.dataDir, storyFilePath(store.dataDir, slug))
    await walkMd(files, store.dataDir, dailyDir(store.dataDir, slug))
    return files.sort((left, right) => left.localeCompare(right, 'en'))
  })
}

async function walkMd(files: string[], dataDir: string, root: string): Promise<void> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      await walkMd(files, dataDir, full)
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(toDataRel(dataDir, full))
    }
  }
}

async function pushExisting(files: string[], dataDir: string, absolute: string): Promise<void> {
  try {
    if ((await stat(absolute)).isFile()) {
      files.push(toDataRel(dataDir, absolute))
    }
  } catch {
    // missing
  }
}

function isGet(request: IncomingMessage): boolean {
  return request.method === undefined || request.method === 'GET'
}

function queryParam(request: IncomingMessage, key: string): string | undefined {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const value = url.searchParams.get(key)
  return value === null ? undefined : value
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of request) {
    body += String(chunk)
    if (body.length > 2_000_000) {
      throw new Error('request body is too large')
    }
  }
  return JSON.parse(body) as unknown
}

function writeHtml(response: ServerResponse, body: string): void {
  response.statusCode = 200
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(body)
}

function writeJson(response: ServerResponse, body: object, statusCode = 200): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}

function writeText(response: ServerResponse, body: string, statusCode: number): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.end(body)
}

function cause(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
