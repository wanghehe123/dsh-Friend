import { describe, expect, it, vi } from 'vitest'

import { FRIEND_TTS_PREVIEW_PATH } from '../src/paths.ts'
import type { FriendTtsReadyEvent } from '../src/playback-events.ts'
import { createTtsPreviewRoute } from '../src/preview-route.ts'
import { FRIEND_TTS_PREVIEW_SENTENCE } from '../src/preview-sentence.ts'
import { createBrowserFallbackInstruction } from '../src/providers/browser.ts'
import { ttsAudioUrl, type FriendTtsSpeakResult } from '../src/service.ts'

type FakeResponse = {
  statusCode: number
  headers: Record<string, string>
  body: string
  setHeader(name: string, value: string): void
  end(body?: string | Buffer): void
}

function response(): FakeResponse {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(body = '') {
      this.body = Buffer.isBuffer(body) ? body.toString('utf8') : String(body)
    },
  }
}

function request(method: string, body?: string) {
  return {
    method,
    url: FRIEND_TTS_PREVIEW_PATH,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield body
    },
  }
}

const CANARY = 'sk-live-CANARY_dsh_friend_tts_key_leak_7f3e9a2c'

describe('POST /friend/tts/preview', () => {
  it('synthesizes the default sentence, pushes tts-ready, and returns no audio bytes', async () => {
    const pushed: FriendTtsReadyEvent[] = []
    const speak = vi.fn(async (): Promise<FriendTtsSpeakResult> => ({
      kind: 'audio',
      providerId: 'edge',
      audio: Buffer.from('ID3secret'),
      mime: 'audio/mpeg',
      id: 'deadbeef',
      audioUrl: ttsAudioUrl('deadbeef'),
      cacheHit: false,
    }))
    const route = createTtsPreviewRoute({
      speak,
      sink: { push: (event) => pushed.push(event) },
    })
    const res = response()
    await route.handler(request('POST', '{}') as never, res as never)
    expect(speak.mock.calls[0]?.[0]).toBe(FRIEND_TTS_PREVIEW_SENTENCE)
    expect(speak.mock.calls[0]?.[1]).toMatchObject({ autoSpeak: true })
    expect(res.statusCode).toBe(200)
    const payload = JSON.parse(res.body) as { kind: string; audioUrl: string; audio?: unknown }
    expect(payload.kind).toBe('audio')
    expect(payload.audioUrl).toBe('/friend/tts/audio/deadbeef')
    expect(payload.audio).toBeUndefined()
    expect(res.body).not.toContain('ID3secret')
    expect(res.body).not.toContain(CANARY)
    expect(pushed).toHaveLength(1)
    expect(pushed[0]?.type).toBe('tts-ready')
    expect(JSON.stringify(pushed[0])).not.toContain('ID3secret')
  })

  it('returns 405 for GET and never speaks', async () => {
    const speak = vi.fn()
    const route = createTtsPreviewRoute({
      speak,
      sink: { push() {} },
    })
    const res = response()
    await route.handler(request('GET') as never, res as never)
    expect(res.statusCode).toBe(405)
    expect(speak).not.toHaveBeenCalled()
  })

  it('returns a browser-fallback payload when the host cannot synthesize', async () => {
    const speak = vi.fn(async () => createBrowserFallbackInstruction('试听', {}, 'provider set to browser'))
    const route = createTtsPreviewRoute({
      speak,
      sink: { push() {} },
    })
    const res = response()
    await route.handler(request('POST', JSON.stringify({ text: '试听', provider: 'browser' })) as never, res as never)
    expect(res.statusCode).toBe(200)
    const payload = JSON.parse(res.body) as { kind: string; engine: string; text: string }
    expect(payload).toMatchObject({
      kind: 'browser-fallback',
      engine: 'speechSynthesis',
      text: '试听',
    })
  })

  it('returns 422 when a pinned synthesizer cannot fulfill the preview', async () => {
    const speak = vi.fn(async () => createBrowserFallbackInstruction(
      '试听',
      {},
      'all synthesizers failed (preferred "openai-compat")',
      [{ id: 'openai-compat', error: 'openai-compat: missing API key' }],
    ))
    const route = createTtsPreviewRoute({
      speak,
      sink: { push() {} },
    })
    const res = response()
    await route.handler(
      request('POST', JSON.stringify({ text: '试听', provider: 'openai-compat' })) as never,
      res as never,
    )
    expect(res.statusCode).toBe(422)
    const payload = JSON.parse(res.body) as {
      ok: boolean
      requestedProvider: string
      failedProviders: Array<{ id: string }>
    }
    expect(payload.ok).toBe(false)
    expect(payload.requestedProvider).toBe('openai-compat')
    expect(payload.failedProviders[0]?.id).toBe('openai-compat')
    expect(res.body).not.toContain(CANARY)
  })
})
