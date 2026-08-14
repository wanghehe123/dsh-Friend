import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'

import { describe, expect, it } from 'vitest'

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
