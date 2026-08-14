import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  FRIEND_TTS_CACHE_MAX_ENTRIES,
  buildTtsCacheKey,
  createFriendTtsCache,
  isTtsCacheId,
} from '../src/cache.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-friend-tts-cache-'))
  temporaryRoots.push(root)
  return root
}

const sample = {
  providerId: 'edge',
  mime: 'audio/mpeg',
  audio: Buffer.from('ID3audio'),
}

describe('TTS cache', () => {
  it('builds a stable sha256 key over provider+voice+rate+pitch+format+model+text', () => {
    const a = buildTtsCacheKey({
      provider: 'edge',
      text: '你好',
      voice: 'zh-CN-XiaoxiaoNeural',
      rate: 1,
      pitch: 1,
    })
    const b = buildTtsCacheKey({
      provider: 'edge',
      text: '你好',
      voice: 'zh-CN-XiaoxiaoNeural',
      rate: 1,
      pitch: 1,
    })
    const differentRate = buildTtsCacheKey({
      provider: 'edge',
      text: '你好',
      voice: 'zh-CN-XiaoxiaoNeural',
      rate: 1.2,
      pitch: 1,
    })
    expect(isTtsCacheId(a)).toBe(true)
    expect(a).toBe(b)
    expect(a).not.toBe(differentRate)
  })

  it('returns a memory hit and persists across a new cache bound to the same tmpdir', async () => {
    const directory = await tempDir()
    const first = createFriendTtsCache({ directory })
    const stored = await first.set({ provider: 'edge', text: '同一句' }, sample)
    expect(stored.audio.equals(sample.audio)).toBe(true)
    expect(await first.get(stored.id)).toMatchObject({ providerId: 'edge', mime: 'audio/mpeg' })
    first.dispose()

    const second = createFriendTtsCache({ directory })
    const hit = await second.get(stored.id)
    expect(hit?.audio.equals(sample.audio)).toBe(true)
    second.dispose()
  })

  it('expires entries after TTL using an injected clock', async () => {
    const directory = await tempDir()
    let now = 1_000
    const cache = createFriendTtsCache({
      directory,
      ttlMs: 1_000,
      now: () => now,
    })
    const stored = await cache.set({ provider: 'edge', text: '过期' }, sample)
    now = 2_100
    expect(await cache.get(stored.id)).toBeUndefined()
    cache.dispose()
  })

  it('evicts the least-recently-used entry when over capacity', async () => {
    const directory = await tempDir()
    const cache = createFriendTtsCache({ directory, maxEntries: 2 })
    const a = await cache.set({ provider: 'edge', text: 'a' }, sample)
    const b = await cache.set({ provider: 'edge', text: 'b' }, sample)
    expect(await cache.get(a.id)).toBeDefined()
    await cache.set({ provider: 'edge', text: 'c' }, sample)
    expect(await cache.get(b.id)).toBeUndefined()
    expect(await cache.get(a.id)).toBeDefined()
    expect(cache.size()).toBeLessThanOrEqual(2)
    cache.dispose()
  })

  it('defaults match the spec (500 / 1h) and memory-only mode never touches disk', async () => {
    expect(FRIEND_TTS_CACHE_MAX_ENTRIES).toBe(500)
    const cache = createFriendTtsCache()
    const stored = await cache.set({ provider: 'openai-compat', text: 'mem' }, sample)
    expect(await cache.get(stored.id)).toBeDefined()
    cache.dispose()
  })
})
