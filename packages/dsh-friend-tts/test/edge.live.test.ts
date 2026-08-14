import { describe, expect, it } from 'vitest'

import { createEdgeTtsProvider } from '../src/providers/edge.ts'

const live = process.env.EDGE_LIVE === '1'

function looksLikeAudio(buf: Buffer): boolean {
  if (buf.length < 4) {
    return false
  }
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    return true
  }
  if (buf[0] === 0xff && ((buf[1] ?? 0) & 0xe0) === 0xe0) {
    return true
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return true
  }
  return false
}

describe.skipIf(!live)('edge live synthesis (EDGE_LIVE=1)', () => {
  it('synthesizes a Chinese sentence and returns an mp3 or webm body', async () => {
    const provider = createEdgeTtsProvider({ timeoutMs: 20_000 })
    const result = await provider.synthesize('你好，我是晓晓。', {
      voice: 'zh-CN-XiaoxiaoNeural',
    })
    expect(result.mime).toMatch(/^audio\/(mpeg|webm)$/)
    expect(result.audio.byteLength).toBeGreaterThan(400)
    expect(looksLikeAudio(result.audio)).toBe(true)
  }, 25_000)
})
