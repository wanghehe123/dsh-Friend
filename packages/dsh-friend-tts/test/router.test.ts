import { describe, expect, it, vi } from 'vitest'

import { apply, createFriendTtsHost } from '../src/index.ts'
import { createFriendTtsRouter, readFriendTtsConfig } from '../src/router.ts'
import {
  FRIEND_TTS_BROWSER_PROVIDER,
  createFriendTtsRegistry,
  type FriendTtsAudio,
  type FriendTtsProvider,
  type FriendTtsSynthesizeOpts,
} from '../src/seam.ts'

function provider(
  id: string,
  synthesize: (text: string, opts?: FriendTtsSynthesizeOpts) => Promise<FriendTtsAudio>,
): FriendTtsProvider {
  return {
    id,
    listVoices: async () => [],
    synthesize,
  }
}

function ok(id: string): FriendTtsProvider {
  return provider(id, async () => ({ audio: Buffer.from(id), mime: 'audio/mpeg' }))
}

function boom(id: string, message = `${id} down`): FriendTtsProvider {
  return provider(id, async () => {
    throw new Error(message)
  })
}

describe('FriendTtsRouter', () => {
  it('uses the preferred provider when it succeeds', async () => {
    const registry = createFriendTtsRegistry()
    registry.register(ok('edge'))
    registry.register(ok('openai-compat'))
    const router = createFriendTtsRouter({
      registry,
      getConfig: () => ({ provider: 'edge' }),
    })

    await expect(router.synthesize('你好')).resolves.toEqual({
      kind: 'audio',
      providerId: 'edge',
      audio: Buffer.from('edge'),
      mime: 'audio/mpeg',
    })
  })

  it('degrades to the next registered provider when the preferred one throws', async () => {
    const registry = createFriendTtsRegistry()
    const log = vi.fn()
    registry.register(boom('edge', 'network down'))
    registry.register(ok('openai-compat'))
    const router = createFriendTtsRouter({
      registry,
      getConfig: () => ({ provider: 'edge' }),
      log,
    })

    await expect(router.synthesize('你好')).resolves.toMatchObject({
      kind: 'audio',
      providerId: 'openai-compat',
    })
    expect(log).toHaveBeenCalledWith(
      'dsh-friend-tts: provider "edge" failed (network down); falling back',
    )
  })

  it('honors a per-call provider pin and does not fall through to the next synthesizer', async () => {
    const registry = createFriendTtsRegistry()
    const log = vi.fn()
    registry.register(ok('edge'))
    registry.register(boom('openai-compat', 'openai-compat: missing API key'))
    const router = createFriendTtsRouter({
      registry,
      getConfig: () => ({ provider: 'edge' }),
      log,
    })

    const result = await router.synthesize('试听', { provider: 'openai-compat' })
    expect(result).toMatchObject({
      kind: 'browser-fallback',
      reason: 'all synthesizers failed (preferred "openai-compat")',
      failedProviders: [{ id: 'openai-compat', error: 'openai-compat: missing API key' }],
    })
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('returns a browser fallback instruction when every synthesizer fails, and does not throw', async () => {
    const registry = createFriendTtsRegistry()
    const log = vi.fn()
    registry.register(boom('edge', 'offline'))
    registry.register(boom('openai-compat', '401'))
    registry.register(ok(FRIEND_TTS_BROWSER_PROVIDER))
    const router = createFriendTtsRouter({
      registry,
      getConfig: () => ({ provider: 'edge', voice: 'zh-CN-XiaoxiaoNeural', rate: 1.1, pitch: 0.9 }),
      log,
    })

    const result = await router.synthesize('今天过得怎么样？')
    expect(result).toEqual({
      kind: 'browser-fallback',
      engine: 'speechSynthesis',
      text: '今天过得怎么样？',
      voice: 'zh-CN-XiaoxiaoNeural',
      rate: 1.1,
      pitch: 0.9,
      uiHint: 'fallback',
      reason: 'all synthesizers failed (preferred "edge")',
      failedProviders: [
        { id: 'edge', error: 'offline' },
        { id: 'openai-compat', error: '401' },
      ],
    })
    expect(log).toHaveBeenCalledTimes(2)
  })

  it('never calls synthesize on a registered browser marker', async () => {
    const registry = createFriendTtsRegistry()
    const browserSynth = vi.fn(async () => ({ audio: Buffer.from('nope'), mime: 'audio/mpeg' }))
    registry.register(provider(FRIEND_TTS_BROWSER_PROVIDER, browserSynth))
    const router = createFriendTtsRouter({
      registry,
      getConfig: () => ({ provider: FRIEND_TTS_BROWSER_PROVIDER }),
    })

    const result = await router.synthesize('hi')
    expect(result.kind).toBe('browser-fallback')
    expect(browserSynth).not.toHaveBeenCalled()
  })

  it('picks up a live config change on the next synthesize without a restart', async () => {
    const registry = createFriendTtsRegistry()
    registry.register(ok('edge'))
    registry.register(ok('openai-compat'))
    let providerId = 'edge'
    const router = createFriendTtsRouter({
      registry,
      getConfig: () => ({ provider: providerId }),
    })

    await expect(router.synthesize('a')).resolves.toMatchObject({ providerId: 'edge' })
    providerId = 'openai-compat'
    await expect(router.synthesize('a')).resolves.toMatchObject({ providerId: 'openai-compat' })
  })

  it('merges per-call opts over config voice/rate/pitch', async () => {
    const registry = createFriendTtsRegistry()
    const seen: FriendTtsSynthesizeOpts[] = []
    registry.register(provider('edge', async (_text, opts) => {
      seen.push(opts ?? {})
      return { audio: Buffer.from('x'), mime: 'audio/mpeg' }
    }))
    const router = createFriendTtsRouter({
      registry,
      getConfig: () => ({ provider: 'edge', voice: 'from-config', rate: 1, pitch: 1 }),
    })

    await router.synthesize('hi', { voice: 'from-call', rate: 1.4 })
    expect(seen[0]).toEqual({ voice: 'from-call', rate: 1.4, pitch: 1 })
  })

  it('swallows getConfig throws and still returns a fallback instead of breaking the session', async () => {
    const registry = createFriendTtsRegistry()
    const log = vi.fn()
    const router = createFriendTtsRouter({
      registry,
      getConfig: () => {
        throw new Error('settings unavailable')
      },
      log,
    })

    await expect(router.synthesize('hi')).resolves.toMatchObject({
      kind: 'browser-fallback',
      engine: 'speechSynthesis',
    })
    expect(log.mock.calls[0]?.[0]).toMatch(/failed to read TTS config/)
  })
})

describe('readFriendTtsConfig', () => {
  it('reads the friend-tts document and ignores junk', () => {
    expect(readFriendTtsConfig({
      provider: 'openai-compat',
      voice: 'alloy',
      rate: 1.2,
      pitch: 0.8,
      extra: true,
    })).toEqual({
      provider: 'openai-compat',
      voice: 'alloy',
      rate: 1.2,
      pitch: 0.8,
    })
    expect(readFriendTtsConfig(undefined)).toEqual({})
    expect(readFriendTtsConfig('edge')).toEqual({})
    expect(readFriendTtsConfig({ provider: '  ' })).toEqual({})
  })
})

describe('createFriendTtsHost', () => {
  it('registers edge by default and disposes it', () => {
    const host = createFriendTtsHost({
      edge: {
        connect: () => {
          throw new Error('unit tests must not open a websocket')
        },
      },
    })
    expect(host.registry.get('edge')?.id).toBe('edge')
    host.dispose()
    expect(host.registry.get('edge')).toBeUndefined()
  })
})

describe('apply', () => {
  it('binds provider registration to ctx.effect so unload unregisters edge', () => {
    let dispose: (() => void) | undefined
    const effect = vi.fn((execute: () => () => void) => {
      dispose = execute()
    })

    apply({ effect })

    expect(effect.mock.calls.some((call) => call[1] === 'dsh-friend-tts: providers')).toBe(true)
    expect(effect.mock.calls.some((call) => call[1] === 'dsh-friend-tts: downlink')).toBe(true)
    expect(typeof dispose).toBe('function')
    dispose?.()
  })
})
