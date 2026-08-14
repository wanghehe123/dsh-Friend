import { describe, expect, it, vi } from 'vitest'

import { createFriendTtsCache } from '../src/cache.ts'
import { createFriendTtsQueue } from '../src/queue.ts'
import { createFriendTtsRouter } from '../src/router.ts'
import { createFriendTtsRegistry, type FriendTtsProvider } from '../src/seam.ts'
import { createFriendTtsService } from '../src/service.ts'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function provider(id: string, synthesize: FriendTtsProvider['synthesize']): FriendTtsProvider {
  return {
    id,
    listVoices: async () => [],
    synthesize,
  }
}

function makeService(
  synthesize: FriendTtsProvider['synthesize'],
  log = vi.fn(),
  extras: { getAutoSpeak?: () => boolean } = {},
) {
  const registry = createFriendTtsRegistry()
  registry.register(provider('edge', synthesize))
  const router = createFriendTtsRouter({
    registry,
    getConfig: () => ({ provider: 'edge' }),
    log,
  })
  const cache = createFriendTtsCache()
  const queue = createFriendTtsQueue()
  const service = createFriendTtsService({
    router,
    cache,
    queue,
    getPreferredProvider: () => 'edge',
    log,
    ...(extras.getAutoSpeak !== undefined ? { getAutoSpeak: extras.getAutoSpeak } : {}),
  })
  return { service, cache, queue, log }
}

describe('TTS speak service (cache + inflight dedupe)', () => {
  it('does not call the provider again on a cache hit', async () => {
    const synthesize = vi.fn(async () => ({ audio: Buffer.from('hit'), mime: 'audio/mpeg' }))
    const { service, log, queue } = makeService(synthesize)

    const first = await service.speak('同一句话', { voice: 'zh-CN-XiaoxiaoNeural' })
    const second = await service.speak('同一句话', { voice: 'zh-CN-XiaoxiaoNeural' })

    expect(first.kind).toBe('audio')
    expect(second.kind).toBe('audio')
    if (first.kind === 'audio' && second.kind === 'audio') {
      expect(first.cacheHit).toBe(false)
      expect(second.cacheHit).toBe(true)
      expect(first.id).toBe(second.id)
      expect(second.audioUrl).toBe(`/friend/tts/audio/${second.id}`)
    }
    expect(synthesize).toHaveBeenCalledTimes(1)
    expect(log.mock.calls.some((call) => String(call[0]).includes('cache hit'))).toBe(true)
    queue.dispose()
  })

  it('coalesces concurrent speak() of the same sentence into one synthesize', async () => {
    let started = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const synthesize = vi.fn(async () => {
      started += 1
      await gate
      return { audio: Buffer.from('once'), mime: 'audio/mpeg' }
    })
    const { service, queue } = makeService(synthesize)

    const a = service.speak('并发同一句')
    const b = service.speak('并发同一句')
    await delay(10)
    expect(started).toBe(1)
    release?.()
    const [left, right] = await Promise.all([a, b])
    expect(synthesize).toHaveBeenCalledTimes(1)
    expect(left.kind).toBe('audio')
    expect(right.kind).toBe('audio')
    if (left.kind === 'audio' && right.kind === 'audio') {
      expect(left.id).toBe(right.id)
    }
    queue.dispose()
  })

  it('prepares tagged text before synthesize so tags are never spoken', async () => {
    const synthesize = vi.fn(async (text: string) => ({ audio: Buffer.from(text), mime: 'audio/mpeg' }))
    const { service, queue } = makeService(synthesize)
    const result = await service.speak('[expr:happy]你好（挥手）')
    expect(result.kind).toBe('audio')
    expect(synthesize).toHaveBeenCalledWith('你好', expect.anything())
    queue.dispose()
  })

  it('enqueues the first sentence first and reports first-ready under the CI budget', async () => {
    const order: string[] = []
    const synthesize = vi.fn(async (text: string) => {
      order.push(text)
      await delay(15)
      return { audio: Buffer.from(text), mime: 'audio/mpeg' }
    })
    const { service, queue } = makeService(synthesize)
    const started = Date.now()
    const batch = await service.speakReply('第一句。第二句。第三句。')
    const elapsed = Date.now() - started
    expect(batch.sentences).toEqual(['第一句。', '第二句。', '第三句。'])
    expect(batch.first?.kind).toBe('audio')
    expect(order[0]).toBe('第一句。')
    expect(elapsed).toBeLessThan(4000)
    expect(batch.firstReadyMs).toBeLessThan(4000)
    await batch.rest
    expect(order).toEqual(['第一句。', '第二句。', '第三句。'])
    queue.dispose()
  })

  it('skips synthesis when autoSpeak is off and resumes when it turns on', async () => {
    const synthesize = vi.fn(async (text: string) => ({ audio: Buffer.from(text), mime: 'audio/mpeg' }))
    let autoSpeak = false
    const { service, queue } = makeService(synthesize, vi.fn(), { getAutoSpeak: () => autoSpeak })

    const silenced = await service.speakReply('你好。世界。')
    expect(silenced.first).toBeUndefined()
    expect(silenced.sentences).toEqual(['你好。', '世界。'])
    expect(synthesize).not.toHaveBeenCalled()

    const explicit = await service.speak('仍不应合成')
    expect(explicit.kind).toBe('browser-fallback')
    expect(synthesize).not.toHaveBeenCalled()

    const forced = await service.speakReply('预览一句。', { autoSpeak: true })
    expect(forced.first?.kind).toBe('audio')
    expect(synthesize).toHaveBeenCalledTimes(1)

    autoSpeak = true
    const spoken = await service.speakReply('开启后朗读。')
    expect(spoken.first?.kind).toBe('audio')
    expect(synthesize).toHaveBeenCalledTimes(2)
    queue.dispose()
  })
})
