import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'

import { describe, expect, it } from 'vitest'

import {
  OPENAI_COMPAT_DEFAULT_MODEL,
  OPENAI_COMPAT_DEFAULT_VOICE,
  OPENAI_COMPAT_PATH,
  OPENAI_COMPAT_PROVIDER_ID,
  OPENAI_COMPAT_VOICES,
  createOpenAiCompatProvider,
  mapRateToSpeed,
} from '../src/providers/openai.ts'

const CANARY = 'sk-live-CANARY_dsh_friend_tts_openai_7f3e9a2c'

type Captured = {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

type MockOptions = {
  status?: number
  body?: Buffer | string
  contentType?: string
  delayMs?: number
  echoKeyInError?: boolean
}

async function withMockServer(
  mock: MockOptions,
  run: (baseURL: string, captured: Captured) => Promise<void>,
): Promise<void> {
  const captured: Captured = { headers: {}, body: '' }
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.on('end', () => {
      captured.method = request.method
      captured.url = request.url
      captured.headers = { ...request.headers }
      captured.body = Buffer.concat(chunks).toString('utf8')
      const finish = (): void => {
        if (mock.echoKeyInError === true) {
          response.statusCode = mock.status ?? 401
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({ error: { message: `invalid key ${CANARY}` } }))
          return
        }
        response.statusCode = mock.status ?? 200
        response.setHeader('content-type', mock.contentType ?? 'audio/mpeg')
        response.end(mock.body ?? Buffer.from('ID3FAKE'))
      }
      if (mock.delayMs !== undefined && mock.delayMs > 0) {
        setTimeout(finish, mock.delayMs)
        return
      }
      finish()
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('mock server missing port')
  }
  const baseURL = `http://127.0.0.1:${String(address.port)}/v1`
  try {
    await run(baseURL, captured)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

describe('openai-compat provider', () => {
  it('POSTs {base}/audio/speech with bearer key, mapped body, and passes audio through', async () => {
    const audio = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00])
    await withMockServer({ body: audio, contentType: 'audio/mpeg' }, async (baseURL, captured) => {
      const provider = createOpenAiCompatProvider({
        getCredentials: () => ({ apiKey: CANARY, baseURL, model: 'tts-1-hd' }),
      })
      expect(provider.id).toBe(OPENAI_COMPAT_PROVIDER_ID)
      expect(await provider.listVoices()).toEqual(OPENAI_COMPAT_VOICES)

      const result = await provider.synthesize('你好呀', {
        voice: 'nova',
        rate: 1.25,
        format: 'mp3',
      })

      expect(captured.method).toBe('POST')
      expect(captured.url).toBe(`/v1${OPENAI_COMPAT_PATH}`)
      expect(captured.headers.authorization).toBe(`Bearer ${CANARY}`)
      expect(captured.headers['content-type']).toBe('application/json')
      expect(JSON.parse(captured.body)).toEqual({
        model: 'tts-1-hd',
        input: '你好呀',
        voice: 'nova',
        response_format: 'mp3',
        speed: 1.25,
      })
      expect(result.mime).toBe('audio/mpeg')
      expect(result.audio.equals(audio)).toBe(true)
    })
  })

  it('maps rate onto OpenAI speed and uses defaults when opts omit voice/model', async () => {
    expect(mapRateToSpeed(undefined)).toBe(1)
    expect(mapRateToSpeed(0.1)).toBe(0.25)
    expect(mapRateToSpeed(8)).toBe(4)

    await withMockServer({}, async (baseURL, captured) => {
      const provider = createOpenAiCompatProvider({
        getCredentials: () => ({ apiKey: CANARY, baseURL }),
      })
      await provider.synthesize('hello')
      expect(JSON.parse(captured.body)).toMatchObject({
        model: OPENAI_COMPAT_DEFAULT_MODEL,
        voice: OPENAI_COMPAT_DEFAULT_VOICE,
        speed: 1,
      })
    })
  })

  it('throws a normalized timeout and never puts the key in the error', async () => {
    await withMockServer({ delayMs: 80 }, async (baseURL) => {
      const provider = createOpenAiCompatProvider({
        getCredentials: () => ({ apiKey: CANARY, baseURL }),
        timeoutMs: 20,
      })
      await expect(provider.synthesize('慢')).rejects.toThrow(/timed out/)
      try {
        await provider.synthesize('慢')
      } catch (error) {
        expect(error instanceof Error ? error.message : String(error)).not.toContain(CANARY)
      }
    })
  })

  it('redacts the key when the mock server echoes it in an error body', async () => {
    await withMockServer({ echoKeyInError: true }, async (baseURL) => {
      const provider = createOpenAiCompatProvider({
        getCredentials: () => ({ apiKey: CANARY, baseURL }),
      })
      await expect(provider.synthesize('hi')).rejects.toThrow(/openai-compat: HTTP 401/)
      try {
        await provider.synthesize('hi')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        expect(message).not.toContain(CANARY)
        expect(message).toContain('[redacted]')
      }
    })
  })

  it('throws a normalized missing-key error without synthesizing', async () => {
    const provider = createOpenAiCompatProvider({
      getCredentials: () => ({ baseURL: 'http://127.0.0.1:9/v1' }),
    })
    await expect(provider.synthesize('hi')).rejects.toThrow(/missing API key/)
  })

  it('does not put the key on synthesize opts — credentials stay in the closure', async () => {
    await withMockServer({}, async (baseURL, captured) => {
      const provider = createOpenAiCompatProvider({
        getCredentials: () => ({ apiKey: CANARY, baseURL }),
      })
      const opts = { voice: 'alloy', rate: 1 }
      await provider.synthesize('hi', opts)
      expect(JSON.stringify(opts)).not.toContain(CANARY)
      expect(Object.hasOwn(opts, 'apiKey')).toBe(false)
      expect(JSON.parse(captured.body)).not.toHaveProperty('apiKey')
      expect(JSON.parse(captured.body)).not.toHaveProperty('openaiApiKey')
    })
  })
})
