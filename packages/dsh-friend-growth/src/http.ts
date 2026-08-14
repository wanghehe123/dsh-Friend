import type { IncomingMessage, ServerResponse } from 'node:http'

export function isGet(request: IncomingMessage): boolean {
  return request.method === undefined || request.method === 'GET'
}

export function writeHtml(response: ServerResponse, body: string, statusCode = 200): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(body)
}

export function writeJson(response: ServerResponse, body: object, statusCode = 200): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}

export function writeText(response: ServerResponse, body: string, statusCode: number): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.end(body)
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of request) {
    body += String(chunk)
    if (body.length > 2_000_000) {
      throw new Error('request body is too large')
    }
  }
  if (body.trim().length === 0) {
    return {}
  }
  return JSON.parse(body) as unknown
}

export function cause(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
