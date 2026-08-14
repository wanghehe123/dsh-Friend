/**
 * Reentrant SSE client: EventSource reconnects natively, but a CLOSED
 * source must be recreated and the badge / snapshot refetch stay in sync.
 */

export type SseReadyState = 0 | 1 | 2

export type SseLike = {
  readyState: SseReadyState
  addEventListener(type: string, listener: (event: { data: string }) => void): void
  close(): void
}

export type SseFactory = (url: string) => SseLike

export type SseClientStatus = 'connected' | 'disconnected'

export type SseClientOptions = Readonly<{
  url: string
  factory: SseFactory
  events?: readonly string[]
  onStatus: (status: SseClientStatus) => void
  onEvent: (type: string, data: string) => void
  onOpen?: () => void
  now?: () => number
  backoffMs?: readonly number[]
  schedule?: (callback: () => void, ms: number) => number
  cancel?: (id: number) => void
}>

export type SseClient = {
  status(): SseClientStatus
  close(): void
  setEnabled(enabled: boolean): void
}

const DEFAULT_BACKOFF_MS = [500, 1_000, 2_000, 5_000] as const

export function createSseClient(options: SseClientOptions): SseClient {
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS
  const schedule = options.schedule ?? ((callback, ms) => setTimeout(callback, ms) as unknown as number)
  const cancel = options.cancel ?? ((id) => clearTimeout(id))
  const events = options.events ?? []
  let source: SseLike | undefined
  let status: SseClientStatus = 'disconnected'
  let attempt = 0
  let timer: number | undefined
  let closed = false
  let enabled = true

  const setStatus = (next: SseClientStatus): void => {
    if (status === next) return
    status = next
    options.onStatus(next)
  }

  const disconnectSource = (): void => {
    if (timer !== undefined) {
      cancel(timer)
      timer = undefined
    }
    try {
      source?.close()
    } catch {
      // ignore
    }
    source = undefined
    setStatus('disconnected')
  }

  const connect = (): void => {
    if (closed || !enabled) return
    if (timer !== undefined) {
      cancel(timer)
      timer = undefined
    }
    try {
      source?.close()
    } catch {
      // ignore
    }
    source = options.factory(options.url)
    source.addEventListener('open', () => {
      attempt = 0
      setStatus('connected')
      options.onOpen?.()
    })
    source.addEventListener('error', () => {
      setStatus('disconnected')
      if (closed || !enabled) return
      if (source !== undefined && source.readyState === 2) {
        const delay = backoff[Math.min(attempt, backoff.length - 1)] ?? 5_000
        attempt += 1
        timer = schedule(connect, delay)
      }
    })
    for (const type of events) {
      source.addEventListener(type, (event) => {
        options.onEvent(type, event.data)
      })
    }
  }

  connect()

  return {
    status() {
      return status
    },
    close() {
      closed = true
      disconnectSource()
    },
    setEnabled(next) {
      if (next === enabled) return
      enabled = next
      if (!next) {
        disconnectSource()
        return
      }
      if (!closed) connect()
    },
  }
}
