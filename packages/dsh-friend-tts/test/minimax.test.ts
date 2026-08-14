import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'

import { describe, expect, it } from 'vitest'

import {
  MINIMAX_DEFAULT_MODEL,
  MINIMAX_DEFAULT_VOICE,
  MINIMAX_PATH,
  MINIMAX_PROVIDER_ID,
  createMiniMaxTtsProvider,
  decodeMiniMaxHex,
  mapPitchToMiniMax,
  mapRateToMiniMaxSpeed,
} from '../src/providers/minimax.ts'

const CANARY = 'sk-live-CANARY_dsh_friend_tts_minimax_9a1c6e44'
const AUDIO = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00])

type Captured = {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

type MockOptions = {
  echoKeyInError?: boolean
  statusCode?: number
  statusMsg?: string
  delayMs?: number
  audioHex?: string
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
          response.statusCode = 401
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({ base_resp: { status_code: 1004, status_msg: `invalid key ${CANARY}` } }))
          return
        }
        response.statusCode = 200
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({
          data: { audio: mock.audioHex ?? AUDIO.toString('hex'), status: 2 },
          extra_info: { audio_format: 'mp3' },
          base_resp: {
            status_code: mock.statusCode ?? 0,
            status_msg: mock.statusMsg ?? 'success',
          },
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
  const baseURL = `http://127.0.0.1:${String(address.port)}/v1`
  try {
    await run(baseURL, captured)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

describe('minimax TTS provider', () => {
  it('POSTs {base}/t2a_v2 and decodes hex audio', async () => {
    expect(decodeMiniMaxHex(AUDIO.toString('hex')).equals(AUDIO)).toBe(true)
    await withMockServer({}, async (baseURL, captured) => {
      const provider = createMiniMaxTtsProvider({
        getCredentials: () => ({
          apiKey: CANARY,
          baseURL,
          model: 'speech-2.8-hd',
          format: 'mp3',
        }),
      })
      expect(provider.id).toBe(MINIMAX_PROVIDER_ID)
      const result = await provider.synthesize('今天天气不错', {
        voice: 'male-qn-qingse',
        rate: 1.2,
        pitch: 1.25,
      })
      expect(captured.method).toBe('POST')
      expect(captured.url).toBe(`/v1${MINIMAX_PATH}`)
      expect(captured.headers.authorization).toBe(`Bearer ${CANARY}`)
      expect(JSON.parse(captured.body)).toEqual({
        model: 'speech-2.8-hd',
        text: '今天天气不错',
        stream: false,
        output_format: 'hex',
        voice_setting: {
          voice_id: 'male-qn-qingse',
          speed: 1.2,
          vol: 1,
          pitch: 3,
        },
        audio_setting: {
          format: 'mp3',
        },
      })
      expect(result.mime).toBe('audio/mpeg')
      expect(result.audio.equals(AUDIO)).toBe(true)
    })
  })

  it('maps rate and pitch onto MiniMax ranges', () => {
    expect(mapRateToMiniMaxSpeed(undefined)).toBe(1)
    expect(mapRateToMiniMaxSpeed(0.1)).toBe(0.5)
    expect(mapRateToMiniMaxSpeed(8)).toBe(2)
    expect(mapPitchToMiniMax(undefined)).toBe(0)
    expect(mapPitchToMiniMax(1)).toBe(0)
    expect(mapPitchToMiniMax(0.5)).toBe(-6)
    expect(mapPitchToMiniMax(2)).toBe(12)
  })

  it('surfaces base_resp errors and redacts the key', async () => {
    expect(MINIMAX_DEFAULT_MODEL).toBe('speech-2.8-hd')
    expect(MINIMAX_DEFAULT_VOICE).toBe('male-qn-qingse')
    await withMockServer({ statusCode: 2013, statusMsg: `bad voice ${CANARY}` }, async (baseURL) => {
      const provider = createMiniMaxTtsProvider({
        getCredentials: () => ({ apiKey: CANARY, baseURL }),
      })
      await expect(provider.synthesize('hi')).rejects.toThrow(/minimax: 2013/)
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
    const missing = createMiniMaxTtsProvider({
      getCredentials: () => ({ baseURL: 'https://api.minimaxi.com/v1' }),
    })
    await expect(missing.synthesize('hi')).rejects.toThrow(/missing API key/)
    const empty = createMiniMaxTtsProvider({
      getCredentials: () => ({ apiKey: CANARY, baseURL: 'https://api.minimaxi.com/v1' }),
    })
    await expect(empty.synthesize('   ')).rejects.toThrow(/refused empty text/)

    await withMockServer({ delayMs: 80 }, async (baseURL) => {
      const provider = createMiniMaxTtsProvider({
        getCredentials: () => ({ apiKey: CANARY, baseURL }),
        timeoutMs: 20,
      })
      await expect(provider.synthesize('慢')).rejects.toThrow(/timed out/)
    })
  })
})
