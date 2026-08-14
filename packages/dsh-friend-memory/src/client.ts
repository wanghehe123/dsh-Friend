/**
 * Client half. Must stay free of `node:` and `@wishp3/dsh-friend-shared`
 * (host). Namespace constants come from `/universal`.
 */
import { FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared/universal'

export const name = '@wishp3/dsh-friend-memory/client'
export const inject: string[] = []

export const MEMORY_SETTINGS_NAMESPACE = FRIEND_SETTINGS_NAMESPACES.memory

export type MemoryBrowserClient = {
  listTree(): Promise<string[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, text: string): Promise<void>
  search(query: string): Promise<Array<{ path: string; line: number; snippet: string; score: number }>>
  distill(): Promise<{ status: string; reason: string }>
}

export type MemoryFetch = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean
  json(): Promise<unknown>
}>

export function createMemoryBrowserClient(fetchImpl: MemoryFetch): MemoryBrowserClient {
  return {
    async listTree() {
      const body = await getJson(fetchImpl, '/friend/memory/tree')
      return Array.isArray((body as { files?: unknown }).files)
        ? (body as { files: string[] }).files
        : []
    },
    async readFile(path) {
      const body = await getJson(fetchImpl, `/friend/memory/file?path=${encodeURIComponent(path)}`)
      return typeof (body as { text?: unknown }).text === 'string' ? (body as { text: string }).text : ''
    },
    async writeFile(path, text) {
      const response = await fetchImpl('/friend/memory/file', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, text }),
      })
      const body = await response.json() as { ok?: unknown; error?: unknown }
      if (body.ok !== true) {
        throw new Error(typeof body.error === 'string' ? body.error : 'save failed')
      }
    },
    async search(query) {
      const body = await getJson(fetchImpl, `/friend/memory/search?q=${encodeURIComponent(query)}`)
      return Array.isArray((body as { hits?: unknown }).hits)
        ? (body as { hits: Array<{ path: string; line: number; snippet: string; score: number }> }).hits
        : []
    },
    async distill() {
      const response = await fetchImpl('/friend/memory/distill', { method: 'POST' })
      const body = await response.json() as { status?: unknown; reason?: unknown }
      return {
        status: typeof body.status === 'string' ? body.status : 'error',
        reason: typeof body.reason === 'string' ? body.reason : '',
      }
    },
  }
}

export function apply(_ctx: unknown): void {
  console.info(`[${name}] apply()`)
}

async function getJson(fetchImpl: MemoryFetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url)
  return response.json()
}

export { FRIEND_SETTINGS_NAMESPACES }
