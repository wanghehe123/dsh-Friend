import { describe, expect, it, vi } from 'vitest'

import {
  EDGE_BUILTIN_VOICES,
  EDGE_DEFAULT_VOICE,
  EDGE_PROVIDER_ID,
  createEdgeTtsProvider,
} from '../src/providers/edge.ts'
import {
  EDGE_TRUSTED_CLIENT_TOKEN,
  EDGE_USER_AGENT,
  EDGE_WSS_URL,
  buildEdgeSsml,
  buildEdgeSynthUrl,
  buildSpeechConfigMessage,
  buildSsmlMessage,
  encodeEdgeAudioFrame,
  generateSecMsGec,
  mapPitchToSsml,
  mapRateToSsml,
  normalizeEdgeVoice,
  parseEdgeMessage,
  resolveEdgeOutput,
  type EdgeSocket,
} from '../src/providers/edge-protocol.ts'

const FIXED_NOW = Date.UTC(2026, 0, 1, 0, 2, 0)

type MockSocket = EdgeSocket & {
  sent: string[]
  url: string
  headers: Readonly<Record<string, string>>
  open: () => void
  emit: (data: unknown) => void
  fail: () => void
  drop: () => void
}

function createMockSocket(): MockSocket {
  const socket: MockSocket = {
    sent: [],
    url: '',
    headers: {},
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data) {
      this.sent.push(data)
    },
    close() {},
    open() {
      this.onopen?.({})
    },
    emit(data) {
      this.onmessage?.({ data })
    },
    fail() {
      this.onerror?.({})
    },
    drop() {
      this.onclose?.({})
    },
  }
  return socket
}

describe('Edge request construction', () => {
  it('maps voice / rate / pitch onto SSML and escapes text', () => {
    expect(mapRateToSsml(1)).toBe('+0%')
    expect(mapRateToSsml(1.5)).toBe('+50%')
    expect(mapRateToSsml(0.5)).toBe('-50%')
    expect(mapPitchToSsml(1)).toBe('+0Hz')
    expect(mapPitchToSsml(1.2)).toBe('+20Hz')
    expect(mapPitchToSsml(0.8)).toBe('-20Hz')
    expect(normalizeEdgeVoice(undefined)).toBe(EDGE_DEFAULT_VOICE)
    expect(normalizeEdgeVoice('edge_zh-CN-YunxiNeural')).toBe('zh-CN-YunxiNeural')

    const ssml = buildEdgeSsml('你好 <world> & 朋友', {
      voice: 'zh-CN-XiaoxiaoNeural',
      rate: 1.5,
      pitch: 1.2,
    })
    expect(ssml).toContain('xml:lang="zh-CN"')
    expect(ssml).toContain('voice name="zh-CN-XiaoxiaoNeural"')
    expect(ssml).toContain('rate="+50%"')
    expect(ssml).toContain('pitch="+20Hz"')
    expect(ssml).toContain('你好 &lt;world&gt; &amp; 朋友')
    expect(ssml).not.toContain('<world>')
  })

  it('builds the speech.config and ssml websocket frames', () => {
    const config = buildSpeechConfigMessage()
    expect(config).toContain('Path:speech.config')
    expect(config).toContain('audio-24khz-48kbitrate-mono-mp3')
    expect(config).toContain('sentenceBoundaryEnabled')

    const ssml = buildSsmlMessage('abc123', '<speak>hi</speak>')
    expect(ssml.startsWith('X-RequestId:abc123\r\n')).toBe(true)
    expect(ssml).toContain('Content-Type:application/ssml+xml')
    expect(ssml).toContain('Path:ssml')
    expect(ssml.endsWith('<speak>hi</speak>')).toBe(true)
  })

  it('puts TrustedClientToken and Sec-MS-GEC on the synth URL', () => {
    const url = buildEdgeSynthUrl({
      nowMs: FIXED_NOW,
      connectionId: 'conn-1',
    })
    expect(url.startsWith(`${EDGE_WSS_URL}?`)).toBe(true)
    expect(url).toContain(`TrustedClientToken=${EDGE_TRUSTED_CLIENT_TOKEN}`)
    expect(url).toContain(`Sec-MS-GEC=${generateSecMsGec(FIXED_NOW)}`)
    expect(url).toContain('Sec-MS-GEC-Version=1-143.0.3650.96')
    expect(url).toContain('ConnectionId=conn-1')
    expect(generateSecMsGec(FIXED_NOW)).toMatch(/^[0-9A-F]{64}$/)
    expect(generateSecMsGec(FIXED_NOW + 60_000)).toBe(generateSecMsGec(FIXED_NOW))
  })

  it('round-trips a length-prefixed audio frame', () => {
    const frame = encodeEdgeAudioFrame('req-1', Buffer.from([0xff, 0xfb, 0x90, 0x00]))
    const parsed = parseEdgeMessage(frame)
    expect(parsed.path).toBe('audio')
    expect(parsed.requestId).toBe('req-1')
    expect(parsed.audio?.equals(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBe(true)
    expect(parseEdgeMessage('X-RequestId:req-1\r\nPath:turn.end\r\n\r\n{}')).toEqual({
      path: 'turn.end',
      requestId: 'req-1',
    })
  })

  it('maps openai-compat format names onto Edge outputFormat + mime', () => {
    expect(resolveEdgeOutput(undefined)).toEqual({
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
      mime: 'audio/mpeg',
    })
    expect(resolveEdgeOutput('webm')).toEqual({
      outputFormat: 'webm-24khz-16bit-mono-opus',
      mime: 'audio/webm',
    })
  })
})

describe('EdgeTtsProvider (protocol mock)', () => {
  it('sends config then SSML and returns concatenated audio without opening a real socket', async () => {
    const socket = createMockSocket()
    const provider = createEdgeTtsProvider({
      now: () => FIXED_NOW,
      requestId: () => 'req-fixed',
      connect: (url, headers) => {
        socket.url = url
        socket.headers = headers
        return socket
      },
    })

    const synth = provider.synthesize('你好呀', { voice: 'zh-CN-XiaoxiaoNeural', rate: 1.25, pitch: 0.9 })
    await Promise.resolve()
    expect(socket.onopen).toBeTypeOf('function')
    socket.open()
    await Promise.resolve()
    expect(socket.sent).toHaveLength(2)
    socket.emit(encodeEdgeAudioFrame('req-fixed', Buffer.from('AA')))
    socket.emit(encodeEdgeAudioFrame('req-fixed', Buffer.from('BB')))
    socket.emit('X-RequestId:req-fixed\r\nPath:turn.end\r\n\r\n{}')

    const result = await synth
    expect(provider.id).toBe(EDGE_PROVIDER_ID)
    expect(result.mime).toBe('audio/mpeg')
    expect(result.audio.toString()).toBe('AABB')
    expect(socket.url).toContain('TrustedClientToken=')
    expect(socket.url).toContain('Sec-MS-GEC=')
    expect(socket.headers['User-Agent']).toBe(EDGE_USER_AGENT)
    expect(socket.sent[0]).toContain('Path:speech.config')
    expect(socket.sent[1]).toContain('Path:ssml')
    expect(socket.sent[1]).toContain('voice name="zh-CN-XiaoxiaoNeural"')
    expect(socket.sent[1]).toContain('rate="+25%"')
    expect(socket.sent[1]).toContain('pitch="-10Hz"')
    expect(socket.sent[1]).toContain('你好呀')
  })

  it('throws on connect failure so the router can degrade', async () => {
    const socket = createMockSocket()
    const provider = createEdgeTtsProvider({
      timeoutMs: 500,
      connect: () => socket,
    })
    const synth = provider.synthesize('你好')
    await Promise.resolve()
    socket.fail()
    await expect(synth).rejects.toThrow(/connect failed/)
  })

  it('throws on timeout when the mock never finishes the turn', async () => {
    const socket = createMockSocket()
    const provider = createEdgeTtsProvider({
      timeoutMs: 40,
      connect: () => socket,
    })
    const synth = provider.synthesize('你好')
    await Promise.resolve()
    socket.open()
    await expect(synth).rejects.toThrow('Edge TTS timed out')
  })

  it('lists voices from the injected fetch and falls back to the builtin set', async () => {
    const provider = createEdgeTtsProvider({
      now: () => FIXED_NOW,
      fetchVoices: async (input) => {
        expect(String(input)).toContain('trustedclienttoken=')
        expect(String(input)).toContain('Sec-MS-GEC=')
        return new Response(JSON.stringify([
          { ShortName: 'zh-CN-XiaoxiaoNeural', FriendlyName: 'Xiaoxiao Online', Locale: 'zh-CN', Gender: 'Female' },
        ]), { status: 200 })
      },
    })
    await expect(provider.listVoices()).resolves.toEqual([
      { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao Online', language: 'zh-CN', gender: 'female' },
    ])

    const offline = createEdgeTtsProvider({
      fetchVoices: async () => {
        throw new Error('offline')
      },
    })
    await expect(offline.listVoices()).resolves.toEqual(EDGE_BUILTIN_VOICES)
  })
})
