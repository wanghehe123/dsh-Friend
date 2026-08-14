import { describe, expect, it, vi } from 'vitest'

import { createFriendTtsRouter } from '../src/router.ts'
import {
  createFriendTtsRegistry,
  type FriendTtsAudio,
  type FriendTtsProvider,
  type FriendTtsSynthesizeOpts,
} from '../src/seam.ts'

function provider(
  id: string,
  synthesize: (text: string, opts?: FriendTtsSynthesizeOpts) => Promise<FriendTtsAudio> = async () => ({
    audio: Buffer.from(id),
    mime: 'audio/mpeg',
  }),
): FriendTtsProvider {
  return {
    id,
    listVoices: async () => [],
    synthesize,
  }
}

describe('FriendTtsRegistry', () => {
  it('registers and unregisters as an effect (disposer removes the occupant)', async () => {
    const registry = createFriendTtsRegistry()
    const edge = provider('edge')

    const dispose = registry.register(edge)

    expect(registry.get('edge')).toBe(edge)
    expect(registry.list()).toEqual([edge])
    expect(await edge.listVoices()).toEqual([])

    dispose()

    expect(registry.get('edge')).toBeUndefined()
    expect(registry.list()).toEqual([])
  })

  it('replaces a duplicate id and makes the previous disposer a no-op', () => {
    const registry = createFriendTtsRegistry()
    const first = provider('edge')
    const second = provider('edge')

    const disposeFirst = registry.register(first)
    const disposeSecond = registry.register(second)

    expect(registry.get('edge')).toBe(second)
    expect(registry.list()).toHaveLength(1)

    disposeFirst()
    expect(registry.get('edge')).toBe(second)

    disposeSecond()
    expect(registry.get('edge')).toBeUndefined()
  })

  it('rejects an empty provider id before touching the table', () => {
    const registry = createFriendTtsRegistry()
    expect(() => registry.register(provider('  '))).toThrow(/non-empty/)
    expect(registry.list()).toEqual([])
  })

  it('stops routing to a provider after its disposer runs', async () => {
    const registry = createFriendTtsRegistry()
    const log = vi.fn()
    const router = createFriendTtsRouter({
      registry,
      getConfig: () => ({ provider: 'edge' }),
      log,
    })
    const dispose = registry.register(provider('edge'))

    const hit = await router.synthesize('你好')
    expect(hit).toMatchObject({ kind: 'audio', providerId: 'edge' })

    dispose()

    const fallback = await router.synthesize('你好')
    expect(fallback).toMatchObject({
      kind: 'browser-fallback',
      engine: 'speechSynthesis',
      uiHint: 'fallback',
    })
    expect(fallback.kind === 'browser-fallback' && fallback.failedProviders).toEqual([])
  })
})
