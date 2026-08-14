import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { createAsrTranscribeProxy } from '../src/proxy.ts'
import { createAsrTranscribeRoute } from '../src/routes.ts'
import { FRIEND_ASR_TRANSCRIBE_PATH } from '../src/paths.ts'

const CANARY = 'sk-live-CANARY_dsh_friend_asr_key_leak_3c1a8d'

type Captured = {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

async function withMockServer(
  handler: (request: IncomingMessage, response: ServerResponse, captured: Captured) => void,
  run: (baseURL: string, captured: Captured) => Promise<void>,
): Promise<void> {
  const captured: Captured = { headers: {}, body: Buffer.alloc(0) }
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.on('end', () => {
      captured.method = request.method
      captured.url = request.url
      captured.headers = { ...request.headers }
      captured.body = Buffer.concat(chunks)
      handler(request, response, captured)
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('mock server missing port')
  }
  try {
    await run(`http://127.0.0.1:${String(address.port)}/v1`, captured)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

describe('ASR host transcription proxy (W-M3-5)', () => {
  it('forwards multipart to /audio/transcriptions and redacts the key', async () => {
    await withMockServer((request, response) => {
      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ text: '今天天气不错' }))
    }, async (baseURL, captured) => {
      const proxy = createAsrTranscribeProxy({
        getCredentials: () => ({ apiKey: CANARY, baseURL, model: 'whisper-1' }),
      })
      const result = await proxy.transcribe({
        audio: new Uint8Array([1, 2, 3, 4]),
        mime: 'audio/webm',
        language: 'zh',
      })
      expect(result.text).toBe('今天天气不错')
      expect(captured.method).toBe('POST')
      expect(captured.url).toBe('/v1/audio/transcriptions')
      expect(String(captured.headers.authorization)).toBe(`Bearer ${CANARY}`)
      const body = captured.body.toString('utf8')
      expect(body).toContain('whisper-1')
      expect(body).toContain('filename=')
    })
  })

  it('uses the DashScope synchronous protocol for qwen3-asr-flash on an api/v1 base URL', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = String(input)
      capturedInit = init
      return new Response(JSON.stringify({
        output: {
          choices: [{
            message: {
              content: [{ text: '欢迎使用阿里云。' }],
            },
          }],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const proxy = createAsrTranscribeProxy({
      fetch: fetchFn as typeof fetch,
      getCredentials: () => ({
        apiKey: CANARY,
        baseURL: 'https://dashscope.aliyuncs.com/api/v1',
        model: 'qwen3-asr-flash',
      }),
    })

    const result = await proxy.transcribe({
      audio: new Uint8Array([1, 2, 3]),
      mime: 'audio/webm',
      language: 'zh-CN',
    })

    expect(capturedUrl).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    )
    expect(capturedInit).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CANARY}`,
        'content-type': 'application/json',
      },
    })
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      model: 'qwen3-asr-flash',
      input: {
        messages: [{
          role: 'user',
          content: [{ audio: 'data:audio/webm;base64,AQID' }],
        }],
      },
      parameters: {
        asr_options: {
          language: 'zh',
          enable_itn: false,
        },
      },
    })
    expect(result.text).toBe('欢迎使用阿里云。')
  })

  it.each([
    'qwen3-asr-flash-filetrans',
    'qwen3-asr-flash-realtime',
  ])('does not route the unsupported %s family to DashScope synchronous ASR', async (model) => {
    let capturedUrl = ''
    const fetchFn = async (input: RequestInfo | URL): Promise<Response> => {
      capturedUrl = String(input)
      return new Response(JSON.stringify({ text: 'generic fallback' }), { status: 200 })
    }
    const proxy = createAsrTranscribeProxy({
      fetch: fetchFn as typeof fetch,
      getCredentials: () => ({
        apiKey: CANARY,
        baseURL: 'https://dashscope.aliyuncs.com/api/v1',
        model,
      }),
    })

    await expect(proxy.transcribe({ audio: new Uint8Array([1]) })).resolves.toEqual({
      text: 'generic fallback',
    })
    expect(capturedUrl).toBe('https://dashscope.aliyuncs.com/api/v1/audio/transcriptions')
  })

  it('rejects qwen3-asr-flash audio whose Base64 data URL exceeds 10 MiB', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
    const proxy = createAsrTranscribeProxy({
      fetch: fetchFn as typeof fetch,
      getCredentials: () => ({
        apiKey: CANARY,
        baseURL: 'https://dashscope.aliyuncs.com/api/v1',
        model: 'qwen3-asr-flash',
      }),
    })

    const rawAudioAtBase64Limit = new Uint8Array(7.5 * 1024 * 1024)
    await expect(proxy.transcribe({
      audio: rawAudioAtBase64Limit,
      mime: 'audio/webm',
    })).rejects.toThrow(/DashScope audio too large/)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('normalizes timeout and never echoes the key', async () => {
    await withMockServer((_request, response) => {
      setTimeout(() => {
        response.statusCode = 200
        response.end(JSON.stringify({ text: 'late' }))
      }, 50)
    }, async (baseURL) => {
      const proxy = createAsrTranscribeProxy({
        getCredentials: () => ({ apiKey: CANARY, baseURL }),
        timeoutMs: 5,
      })
      await expect(proxy.transcribe({ audio: new Uint8Array([1]) })).rejects.toThrow(/timed out/)
      await expect(proxy.transcribe({ audio: new Uint8Array([1]) })).rejects.not.toThrow(new RegExp(CANARY))
    })
  })

  it('route accepts POST only and returns 405 otherwise', async () => {
    const route = createAsrTranscribeRoute({
      proxy: { transcribe: async () => ({ text: 'ok' }) },
    })
    expect(route).toMatchObject({ kind: 'exact', path: FRIEND_ASR_TRANSCRIBE_PATH })
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      body: '',
      setHeader(name: string, value: string) {
        this.headers[name] = value
      },
      end(body = '') {
        this.body = String(body)
      },
    }
    await route.handler({ method: 'GET', url: FRIEND_ASR_TRANSCRIBE_PATH, headers: {} } as never, res as never)
    expect(res.statusCode).toBe(405)
  })
})
