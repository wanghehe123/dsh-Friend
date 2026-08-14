import type { IncomingMessage, ServerResponse } from 'node:http'

export function writeJson(response: ServerResponse, body: object, statusCode = 200): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}

export function writeText(response: ServerResponse, body: string, statusCode: number): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(body)
}

export function isGet(request: IncomingMessage): boolean {
  return request.method === undefined || request.method === 'GET'
}

export async function readJsonBody(request: IncomingMessage, maxBytes = 8_192): Promise<unknown> {
  const raw = await readBinaryBody(request, maxBytes)
  const text = new TextDecoder().decode(raw)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Request body must be JSON')
  }
}

export async function readBinaryBody(request: IncomingMessage, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk))
    total += bytes.byteLength
    if (total > maxBytes) {
      throw new Error(`Request body exceeds the ${maxBytes} byte size limit`)
    }
    chunks.push(bytes)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export function headerValue(request: IncomingMessage, name: string): string | undefined {
  const raw = request.headers[name]
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return raw[0]
  return undefined
}

export function queryParam(request: IncomingMessage, key: string): string | undefined {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const value = url.searchParams.get(key)
  return value === null || value.length === 0 ? undefined : value
}

/**
 * Pull a zip payload out of a raw body or a multipart/form-data part named
 * `file` / `zip` / `model`. Also reads an optional `name` field.
 */
export async function readZipUpload(
  request: IncomingMessage,
  maxBytes: number,
): Promise<{ archive: Uint8Array; name?: string }> {
  const type = headerValue(request, 'content-type') ?? ''
  const named = headerValue(request, 'x-friend-model-name') ?? queryParam(request, 'name')
  if (type.includes('multipart/form-data')) {
    const parsed = parseMultipartZip(await readBinaryBody(request, maxBytes), type)
    const name = parsed.name ?? named
    return name === undefined ? { archive: parsed.archive } : { archive: parsed.archive, name }
  }
  const archive = await readBinaryBody(request, maxBytes)
  return named === undefined ? { archive } : { archive, name: named }
}

export function parseMultipartZip(
  body: Uint8Array,
  contentType: string,
): { archive: Uint8Array; name?: string } {
  const boundary = /boundary=([^;]+)/u.exec(contentType)?.[1]
  if (boundary === undefined) {
    throw new Error('multipart/form-data is missing a boundary')
  }
  const text = new TextDecoder('latin1').decode(body)
  const delimiter = `--${boundary}`
  const parts = text.split(delimiter)
  let archive: Uint8Array | undefined
  let name: string | undefined
  for (const part of parts) {
    if (part.length === 0 || part.startsWith('--')) continue
    const split = part.indexOf('\r\n\r\n')
    if (split < 0) continue
    const headers = part.slice(0, split)
    const raw = part.slice(split + 4).replace(/\r\n$/u, '')
    const disposition = /name="([^"]+)"/u.exec(headers)
    const field = disposition?.[1]
    if (field === 'name' && name === undefined) {
      name = new TextDecoder().decode(latin1ToBytes(raw)).trim()
      continue
    }
    if (field === 'file' || field === 'zip' || field === 'model' || headers.includes('filename=')) {
      archive = latin1ToBytes(raw)
    }
  }
  if (archive === undefined) {
    throw new Error('multipart upload must include a zip file field')
  }
  return name === undefined ? { archive } : { archive, name }
}

function latin1ToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) {
    out[i] = text.charCodeAt(i) & 0xff
  }
  return out
}
