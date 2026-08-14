import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'

import { describe, expect, it } from 'vitest'

import {
  DASHSCOPE_COSYVOICE_PATH,
  DASHSCOPE_DEFAULT_MODEL,
  DASHSCOPE_DEFAULT_VOICE,
  DASHSCOPE_PROVIDER_ID,
  DASHSCOPE_QWEN_TTS_PATH,
  createDashScopeTtsProvider,
  dashscopeSpeechUrl,
  normalizeDashScopeRoot,
} from '../src/providers/dashscope.ts'

const CANARY = 'sk-live-CANARY_dsh_friend_tts_dashscope_4b8c1e0d'

type Captured = {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

type MockOptions = {
  mode?: 'qwen-url' | 'qwen-base64' | 'cosyvoice' | 'echo-key' | 'delay'
  status?: number
  delayMs?: number
}

async function withMockServer(
  mock: MockOptions,
  run: (origin: string, captured: Captured[]) => Promise<void>,
): Promise<void> {
  const captured: Captured[] = []
  const audio = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00])
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.on('end', () => {
      const item: Captured = {
        method: request.method,
        url: request.url,
        headers: { ...request.headers },
        body: Buffer.concat(chunks).toString('utf8'),
      }
      captured.push(item)

      const finish = (): void => {
        if (mock.mode === 'echo-key') {
          response.statusCode = mock.status ?? 401
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({ message: `invalid key ${CANARY}` }))
          return
        }
        if (request.url === '/audio.bin') {
          response.statusCode = 200
          response.setHeader('content-type', 'audio/wav')
          response.end(audio)
          return
        }
        const address = server.address()
        const port = address !== null && typeof address !== 'string' ? address.port : 0
        const fileUrl = `http://127.0.0.1:${String(port)}/audio.bin`
        response.statusCode = mock.status ?? 200
        response.setHeader('content-type', 'application/json')
        if (mock.mode === 'qwen-base64') {
          response.end(JSON.stringify({
            output: { audio: { data: audio.toString('base64'), url: '' } },
          }))
          return
        }
        response.end(JSON.stringify({
          output: { audio: { url: fileUrl, data: '' } },
        }))
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
  const origin = `http://127.0.0.1:${String(address.port)}`
  try {
    await run(origin, captured)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

describe('dashscope TTS provider', () => {
  it('normalizes compatible-mode and bare hosts onto /api/v1', () => {
    expect(normalizeDashScopeRoot('https://dashscope.aliyuncs.com/api/v1')).toBe(
      'https://dashscope.aliyuncs.com/api/v1',
    )
    expect(normalizeDashScopeRoot('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe(
      'https://dashscope.aliyuncs.com/api/v1',
    )
    expect(normalizeDashScopeRoot('https://dashscope.aliyuncs.com')).toBe(
      'https://dashscope.aliyuncs.com/api/v1',
    )
    expect(dashscopeSpeechUrl('https://dashscope.aliyuncs.com/api/v1', 'qwen3-tts-instruct-flash'))
      .toBe(`https://dashscope.aliyuncs.com/api/v1${DASHSCOPE_QWEN_TTS_PATH}`)
    expect(dashscopeSpeechUrl('https://dashscope.aliyuncs.com/api/v1', 'cosyvoice-v3-flash'))
      .toBe(`https://dashscope.aliyuncs.com/api/v1${DASHSCOPE_COSYVOICE_PATH}`)
  })

  it('POSTs Qwen-TTS generation and downloads output.audio.url', async () => {
    await withMockServer({ mode: 'qwen-url' }, async (origin, captured) => {
      const provider = createDashScopeTtsProvider({
        getCredentials: () => ({
          apiKey: CANARY,
          baseURL: `${origin}/api/v1`,
          model: 'qwen3-tts-instruct-flash',
        }),
      })
      expect(provider.id).toBe(DASHSCOPE_PROVIDER_ID)

      const result = await provider.synthesize('你好呀', { voice: 'Cherry' })
      const post = captured.find((item) => item.method === 'POST')
      expect(post?.url).toBe(`/api/v1${DASHSCOPE_QWEN_TTS_PATH}`)
      expect(post?.headers.authorization).toBe(`Bearer ${CANARY}`)
      expect(JSON.parse(post?.body ?? '{}')).toEqual({
        model: 'qwen3-tts-instruct-flash',
        input: { text: '你好呀', voice: 'Cherry' },
      })
      expect(captured.some((item) => item.method === 'GET' && item.url === '/audio.bin')).toBe(true)
      expect(result.mime).toBe('audio/wav')
      expect(result.audio.subarray(0, 4).toString('ascii')).toBe('RIFF')
    })
  })

  it('accepts base64 audio when the URL is empty', async () => {
    await withMockServer({ mode: 'qwen-base64' }, async (origin) => {
      const provider = createDashScopeTtsProvider({
        getCredentials: () => ({ apiKey: CANARY, baseURL: `${origin}/api/v1` }),
      })
      const result = await provider.synthesize('hi')
      expect(result.audio.subarray(0, 4).toString('ascii')).toBe('RIFF')
    })
  })

  it('routes CosyVoice models onto SpeechSynthesizer and passes format', async () => {
    await withMockServer({ mode: 'cosyvoice' }, async (origin, captured) => {
      const provider = createDashScopeTtsProvider({
        getCredentials: () => ({
          apiKey: CANARY,
          baseURL: `${origin}/api/v1`,
          model: 'cosyvoice-v3-flash',
          format: 'mp3',
        }),
      })
      await provider.synthesize('花园', { voice: 'longanyang' })
      const post = captured.find((item) => item.method === 'POST')
      expect(post?.url).toBe(`/api/v1${DASHSCOPE_COSYVOICE_PATH}`)
      expect(JSON.parse(post?.body ?? '{}')).toEqual({
        model: 'cosyvoice-v3-flash',
        input: { text: '花园', voice: 'longanyang', format: 'mp3' },
      })
    })
  })

  it('uses catalog defaults and redacts the key from errors', async () => {
    expect(DASHSCOPE_DEFAULT_MODEL).toBe('qwen3-tts-flash')
    expect(DASHSCOPE_DEFAULT_VOICE).toBe('Cherry')
    await withMockServer({ mode: 'echo-key' }, async (origin) => {
      const provider = createDashScopeTtsProvider({
        getCredentials: () => ({ apiKey: CANARY, baseURL: `${origin}/api/v1` }),
      })
      await expect(provider.synthesize('hi')).rejects.toThrow(/dashscope: HTTP 401/)
      try {
        await provider.synthesize('hi')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        expect(message).not.toContain(CANARY)
        expect(message).toContain('[redacted]')
      }
    })
  })

  it('throws a normalized timeout and refuses empty text or a missing key', async () => {
    const missing = createDashScopeTtsProvider({
      getCredentials: () => ({ baseURL: 'https://dashscope.aliyuncs.com/api/v1' }),
    })
    await expect(missing.synthesize('hi')).rejects.toThrow(/missing API key/)
    const empty = createDashScopeTtsProvider({
      getCredentials: () => ({ apiKey: CANARY, baseURL: 'https://dashscope.aliyuncs.com/api/v1' }),
    })
    await expect(empty.synthesize('   ')).rejects.toThrow(/refused empty text/)

    await withMockServer({ delayMs: 80 }, async (origin) => {
      const provider = createDashScopeTtsProvider({
        getCredentials: () => ({ apiKey: CANARY, baseURL: `${origin}/api/v1` }),
        timeoutMs: 20,
      })
      await expect(provider.synthesize('慢')).rejects.toThrow(/timed out/)
    })
  })
})
