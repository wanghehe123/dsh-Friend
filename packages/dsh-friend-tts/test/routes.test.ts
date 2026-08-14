import { describe, expect, it } from 'vitest'

import { buildTtsCacheKey, createFriendTtsCache, type FriendTtsCachedAudio } from '../src/cache.ts'
import { FRIEND_TTS_AUDIO_PATH } from '../src/paths.ts'
import { createTtsAudioRoute } from '../src/routes.ts'

type FakeResponse = {
  statusCode: number
  headers: Record<string, string>
  body: Buffer
  setHeader(name: string, value: string): void
  end(body?: string | Buffer): void
}

function response(): FakeResponse {
  return {
    statusCode: 0,
    headers: {},
    body: Buffer.alloc(0),
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(body = '') {
      this.body = Buffer.isBuffer(body) ? body : Buffer.from(body)
    },
  }
}

const AUDIO = Buffer.from('ID3cached')
const ID = buildTtsCacheKey({ provider: 'edge', text: '路由一句' })

const ENTRY: FriendTtsCachedAudio = {
  id: ID,
  providerId: 'edge',
  mime: 'audio/mpeg',
  audio: AUDIO,
  createdAt: Date.now(),
}

describe('GET /friend/tts/audio prefix route', () => {
  it('registers a prefix route and returns 200 with mime + cache headers for a known id', async () => {
    const cache = createFriendTtsCache()
    await cache.set({ provider: 'edge', text: '路由一句' }, {
      providerId: 'edge',
      mime: 'audio/mpeg',
      audio: AUDIO,
    })
    const route = createTtsAudioRoute({ getAudio: (id) => cache.get(id) })
    expect(route).toMatchObject({ kind: 'prefix', path: FRIEND_TTS_AUDIO_PATH })

    const res = response()
    await route.handler({ method: 'GET', url: `${FRIEND_TTS_AUDIO_PATH}/${ID}` } as never, res as never)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('audio/mpeg')
    expect(res.headers['cache-control']).toBe('private, max-age=3600')
    expect(res.body.equals(AUDIO)).toBe(true)
    cache.dispose()
  })

  it('returns 404 for an unknown or malformed id', async () => {
    const route = createTtsAudioRoute({ getAudio: async () => undefined })
    const missing = response()
    await route.handler({ method: 'GET', url: `${FRIEND_TTS_AUDIO_PATH}/${ID}` } as never, missing as never)
    expect(missing.statusCode).toBe(404)

    const empty = response()
    await route.handler({ method: 'GET', url: FRIEND_TTS_AUDIO_PATH } as never, empty as never)
    expect(empty.statusCode).toBe(404)

    const bad = response()
    await route.handler({ method: 'GET', url: `${FRIEND_TTS_AUDIO_PATH}/not-a-hash` } as never, bad as never)
    expect(bad.statusCode).toBe(404)
  })

  it('returns 405 for every non-GET method', async () => {
    const route = createTtsAudioRoute({ getAudio: async () => ENTRY })
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
      const res = response()
      await route.handler({ method, url: `${FRIEND_TTS_AUDIO_PATH}/${ID}` } as never, res as never)
      expect(res.statusCode, method).toBe(405)
    }
  })

  it('returns 403 for raw and encoded path traversal', async () => {
    const route = createTtsAudioRoute({ getAudio: async () => ENTRY })
    const urls = [
      `${FRIEND_TTS_AUDIO_PATH}/../../etc/passwd`,
      `${FRIEND_TTS_AUDIO_PATH}/%2e%2e%2fetc/passwd`,
      `${FRIEND_TTS_AUDIO_PATH}/vendor/%2e%2e/%2e%2e/etc/passwd`,
      `${FRIEND_TTS_AUDIO_PATH}/vendor%2F..%2Fsecret.txt`,
    ]
    for (const url of urls) {
      const res = response()
      await route.handler({ method: 'GET', url } as never, res as never)
      expect(res.statusCode, url).toBe(403)
    }
  })
})
