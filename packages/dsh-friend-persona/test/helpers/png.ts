import { deflateSync } from 'node:zlib'

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

/** Minimal 1×1 RGB PNG with a text chunk. Built in-process — no binary fixture in git. */
export function makePngWithTextChunk(
  keyword: string,
  text: string,
  kind: 'tEXt' | 'iTXt' = 'tEXt',
): Uint8Array {
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, 1)
  ihdrView.setUint32(4, 1)
  ihdr[8] = 8
  ihdr[9] = 2

  const raw = new Uint8Array(4)
  raw[1] = 255
  const idat = Uint8Array.from(deflateSync(raw))
  const textData = kind === 'tEXt' ? encodeLatin1(`${keyword}\0${text}`) : encodeItxt(keyword, text)

  return concat(
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk(kind, textData),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array()),
  )
}

export function encodeCharaBase64(card: unknown): string {
  return Buffer.from(JSON.stringify(card), 'utf8').toString('base64')
}

function encodeItxt(keyword: string, text: string): Uint8Array {
  const head = encodeLatin1(`${keyword}\0\0\0\0\0`)
  const body = new TextEncoder().encode(text)
  const out = new Uint8Array(head.length + body.length)
  out.set(head, 0)
  out.set(body, head.length)
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const payload = new Uint8Array(typeBytes.length + data.length)
  payload.set(typeBytes, 0)
  payload.set(data, typeBytes.length)
  const crc = crc32(payload)
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(payload, 4)
  view.setUint32(8 + data.length, crc)
  return out
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function encodeLatin1(value: string): Uint8Array {
  const out = new Uint8Array(value.length)
  for (let index = 0; index < value.length; index += 1) {
    out[index] = value.charCodeAt(index) & 0xff
  }
  return out
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
