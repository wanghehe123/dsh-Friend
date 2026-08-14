export function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/u, '')
}

export function redact(message: string, apiKey: string): string {
  if (apiKey.length === 0) {
    return message
  }
  return message.split(apiKey).join('[redacted]')
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function startDeadline(timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  timer.unref?.()
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
    },
  }
}

export function normalizeFetchError(error: unknown, prefix: string): string {
  if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))) {
    return `${prefix}: timed out`
  }
  return `${prefix}: ${error instanceof Error ? error.message : String(error)}`
}

export async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text()
    if (text.length === 0) {
      return response.statusText
    }
    try {
      const parsed: unknown = JSON.parse(text)
      if (isRecord(parsed)) {
        const nested = isRecord(parsed.error) ? parsed.error : undefined
        const message = asNonEmptyString(parsed.message)
          ?? (nested !== undefined ? asNonEmptyString(nested.message) : undefined)
        if (message !== undefined) {
          return message
        }
      }
    } catch {
      // not JSON
    }
    return text.slice(0, 200)
  } catch {
    return response.statusText
  }
}
