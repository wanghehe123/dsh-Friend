declare module 'ws' {
  export default class WebSocket {
    constructor(address: string, options?: { headers?: Record<string, string> })
    binaryType: string
    send(data: string | Buffer): void
    close(): void
    onopen: ((event: unknown) => void) | null
    onmessage: ((event: { data: unknown }) => void) | null
    onerror: ((event: unknown) => void) | null
    onclose: ((event: unknown) => void) | null
  }
}
