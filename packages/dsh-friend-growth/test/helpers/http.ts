type Response = {
  statusCode: number
  headers: Record<string, string>
  body: string
  writableEnded: boolean
  setHeader: (name: string, value: string) => void
  end: (body?: string) => void
  write: (chunk: string) => boolean
  flushHeaders?: () => void
  on: (event: string, listener: () => void) => void
}

export function createResponse(): Response {
  const response: Response = {
    statusCode: 0,
    headers: {},
    body: '',
    writableEnded: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(body = '') {
      this.body += String(body)
      this.writableEnded = true
    },
    write(chunk) {
      this.body += chunk
      return true
    },
    flushHeaders() {},
    on() {},
  }
  return response
}

export function route<T extends { path: string }>(routes: readonly T[], path: string): T {
  const found = routes.find((item) => item.path === path)
  if (found === undefined) {
    throw new Error(`missing route ${path}`)
  }
  return found
}
