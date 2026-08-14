import { FRIEND_GITHUB_RELEASES_API } from './github-repo.ts'

export type UpdateCheckStatus = 'latest' | 'available' | 'failed'

export type UpdateCheckResult = {
  status: UpdateCheckStatus
  current: string
  latest?: string
  detail?: string
}

export type UpdateCheckFetch = (url: string) => Promise<{
  ok: boolean
  json(): Promise<unknown>
}>

/** @deprecated Use {@link FRIEND_GITHUB_RELEASES_API} from `github-repo.ts`. */
export const DEFAULT_RELEASES_URL = FRIEND_GITHUB_RELEASES_API

export type CheckForUpdateOptions = {
  current: string
  fetchImpl?: UpdateCheckFetch
  url?: string
}

export async function checkForUpdate(options: CheckForUpdateOptions): Promise<UpdateCheckResult> {
  const fetchImpl = options.fetchImpl ?? defaultFetch
  const url = options.url ?? DEFAULT_RELEASES_URL
  try {
    const response = await fetchImpl(url)
    if (!response.ok) {
      return { status: 'failed', current: options.current, detail: `http ${String(response.ok)}` }
    }
    const body = await response.json()
    const latest = readTag(body)
    if (latest === undefined) {
      return { status: 'failed', current: options.current, detail: 'missing tag_name' }
    }
    if (normalizeVersion(latest) === normalizeVersion(options.current)) {
      return { status: 'latest', current: options.current, latest }
    }
    return { status: 'available', current: options.current, latest }
  } catch (error) {
    return {
      status: 'failed',
      current: options.current,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

function readTag(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return undefined
  }
  const tag = (body as Record<string, unknown>).tag_name
  return typeof tag === 'string' && tag.trim().length > 0 ? tag.trim() : undefined
}

function normalizeVersion(value: string): string {
  return value.replace(/^v/iu, '').trim()
}

async function defaultFetch(url: string): Promise<{ ok: boolean; json(): Promise<unknown> }> {
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.github+json' },
  })
  return {
    ok: response.ok,
    json: () => response.json() as Promise<unknown>,
  }
}
