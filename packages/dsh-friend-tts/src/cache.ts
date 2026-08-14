/**
 * TTS audio cache: SHA-256 id over provider+voice+rate+pitch+format+model+text,
 * in-memory LRU (500) + optional write-through under `cache/tts/`, TTL 1 hour.
 */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const FRIEND_TTS_CACHE_MAX_ENTRIES = 500
export const FRIEND_TTS_CACHE_TTL_MS = 60 * 60 * 1000
export const FRIEND_TTS_CACHE_ID_PATTERN = /^[a-f0-9]{64}$/

export type FriendTtsCacheKeyInput = {
  provider: string
  text: string
  voice?: string
  rate?: number
  pitch?: number
  format?: string
  model?: string
}

export type FriendTtsCachedAudio = {
  id: string
  providerId: string
  mime: string
  audio: Buffer
  createdAt: number
}

type CacheMeta = {
  id: string
  providerId: string
  mime: string
  createdAt: number
  bytes: number
}

export type FriendTtsCache = {
  key(input: FriendTtsCacheKeyInput): string
  get(id: string): Promise<FriendTtsCachedAudio | undefined>
  set(input: FriendTtsCacheKeyInput, audio: { providerId: string; mime: string; audio: Buffer }): Promise<FriendTtsCachedAudio>
  has(id: string): Promise<boolean>
  size(): number
  dispose(): void
}

export type CreateFriendTtsCacheOptions = {
  /** When omitted, memory-only (no disk). Tests that touch disk pass `os.tmpdir()`. */
  directory?: string
  maxEntries?: number
  ttlMs?: number
  now?: () => number
}

export function buildTtsCacheKey(input: FriendTtsCacheKeyInput): string {
  const payload = [
    input.provider,
    input.voice ?? '',
    normNum(input.rate, 1),
    normNum(input.pitch, 1),
    input.format ?? '',
    input.model ?? '',
    input.text,
  ].join('\0')
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

export function isTtsCacheId(id: string): boolean {
  return FRIEND_TTS_CACHE_ID_PATTERN.test(id)
}

export function createFriendTtsCache(options: CreateFriendTtsCacheOptions = {}): FriendTtsCache {
  const maxEntries = options.maxEntries ?? FRIEND_TTS_CACHE_MAX_ENTRIES
  const ttlMs = options.ttlMs ?? FRIEND_TTS_CACHE_TTL_MS
  const now = options.now ?? Date.now
  const directory = options.directory
  const memory = new Map<string, FriendTtsCachedAudio>()
  let ready: Promise<void> | undefined

  const ensureReady = (): Promise<void> => {
    if (directory === undefined) {
      return Promise.resolve()
    }
    ready ??= hydrateFromDisk()
    return ready
  }

  async function hydrateFromDisk(): Promise<void> {
    if (directory === undefined) {
      return
    }
    try {
      await mkdir(directory, { recursive: true })
    } catch {
      return
    }
    let names: string[]
    try {
      names = await readdir(directory)
    } catch {
      return
    }
    const metas = names.filter((name) => name.endsWith('.json')).sort()
    for (const name of metas) {
      const id = name.slice(0, -'.json'.length)
      if (!isTtsCacheId(id)) {
        continue
      }
      try {
        const meta = JSON.parse(await readFile(join(directory, name), 'utf8')) as CacheMeta
        if (meta.id !== id || expired(meta.createdAt)) {
          await removeDisk(id)
          continue
        }
        const audio = await readFile(join(directory, `${id}.audio`))
        memory.set(id, {
          id,
          providerId: meta.providerId,
          mime: meta.mime,
          audio,
          createdAt: meta.createdAt,
        })
      } catch {
        await removeDisk(id)
      }
    }
    await evictOverflow()
  }

  function expired(createdAt: number): boolean {
    return now() - createdAt >= ttlMs
  }

  function touch(id: string, entry: FriendTtsCachedAudio): void {
    memory.delete(id)
    memory.set(id, entry)
  }

  async function evictOverflow(): Promise<void> {
    while (memory.size > maxEntries) {
      const oldest = memory.keys().next().value
      if (oldest === undefined) {
        break
      }
      memory.delete(oldest)
      await removeDisk(oldest)
    }
  }

  async function removeDisk(id: string): Promise<void> {
    if (directory === undefined) {
      return
    }
    await rm(join(directory, `${id}.json`), { force: true })
    await rm(join(directory, `${id}.audio`), { force: true })
  }

  async function writeDisk(entry: FriendTtsCachedAudio): Promise<void> {
    if (directory === undefined) {
      return
    }
    await mkdir(directory, { recursive: true })
    const meta: CacheMeta = {
      id: entry.id,
      providerId: entry.providerId,
      mime: entry.mime,
      createdAt: entry.createdAt,
      bytes: entry.audio.byteLength,
    }
    await writeFile(join(directory, `${entry.id}.audio`), entry.audio)
    await writeFile(join(directory, `${entry.id}.json`), JSON.stringify(meta))
  }

  return {
    key: buildTtsCacheKey,

    async get(id) {
      await ensureReady()
      const hit = memory.get(id)
      if (hit === undefined) {
        return undefined
      }
      if (expired(hit.createdAt)) {
        memory.delete(id)
        await removeDisk(id)
        return undefined
      }
      touch(id, hit)
      return hit
    },

    async set(input, audio) {
      await ensureReady()
      const id = buildTtsCacheKey(input)
      const entry: FriendTtsCachedAudio = {
        id,
        providerId: audio.providerId,
        mime: audio.mime,
        audio: audio.audio,
        createdAt: now(),
      }
      touch(id, entry)
      await writeDisk(entry)
      await evictOverflow()
      return entry
    },

    async has(id) {
      return (await this.get(id)) !== undefined
    },

    size() {
      return memory.size
    },

    dispose() {
      memory.clear()
    },
  }
}

function normNum(value: number | undefined, fallback: number): string {
  const n = value === undefined || !Number.isFinite(value) ? fallback : value
  return n.toFixed(4)
}
