/**
 * Client half. Must stay free of `node:` and `@wishp3/dsh-friend-shared`
 * (host). Namespace constants come from `/universal`.
 */
import { FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared/universal'

export const name = '@wishp3/dsh-friend-growth/client'
export const inject: string[] = []

export const GROWTH_SETTINGS_NAMESPACE = FRIEND_SETTINGS_NAMESPACES.growth

export type GrowthFetch = (input: string, init?: {
  method?: string
  headers?: Record<string, string>
  body?: string
}) => Promise<{
  ok: boolean
  json(): Promise<unknown>
}>

export type GrowthBrowserClient = {
  draft(): Promise<unknown>
  generate(body: Record<string, unknown>): Promise<unknown>
  exclude(ids: readonly string[]): Promise<unknown>
  commit(excludedIds: readonly string[]): Promise<unknown>
}

export function createGrowthBrowserClient(fetchImpl: GrowthFetch): GrowthBrowserClient {
  return {
    async draft() {
      return getJson(fetchImpl, '/friend/growth/draft')
    },
    async generate(body) {
      const response = await fetchImpl('/friend/growth/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      return response.json()
    },
    async exclude(ids) {
      const response = await fetchImpl('/friend/growth/exclude', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      return response.json()
    },
    async commit(excludedIds) {
      const response = await fetchImpl('/friend/growth/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ excludedIds }),
      })
      return response.json()
    },
  }
}

export function apply(_ctx: unknown): void {
  console.info(`[${name}] apply()`)
}

async function getJson(fetchImpl: GrowthFetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url)
  return response.json()
}

export { FRIEND_SETTINGS_NAMESPACES }
