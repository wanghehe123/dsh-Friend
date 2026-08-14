export async function postJson(path: string, body?: Record<string, unknown>): Promise<unknown> {
  return requestJson(path, {
    method: 'POST',
    ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
}

export async function getJson(path: string): Promise<unknown> {
  return requestJson(path, { method: 'GET' })
}

export async function postForm(path: string, body: FormData): Promise<unknown> {
  return requestJson(path, { method: 'POST', form: body })
}

export async function requestJson(path: string, init: {
  method: string
  headers?: Record<string, string>
  body?: string
  form?: FormData
}): Promise<unknown> {
  const fetchImpl = (globalThis as { fetch?: typeof fetch }).fetch
  if (fetchImpl === undefined) {
    return undefined
  }
  try {
    const response = await fetchImpl(path, init.form === undefined
      ? init
      : { method: init.method, body: init.form })
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      return response.json()
    }
    return undefined
  } catch {
    return undefined
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
