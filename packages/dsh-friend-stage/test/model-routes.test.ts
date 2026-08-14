import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'

import { createModelRoutes } from '../src/model-routes.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

class BodyRequest extends EventEmitter {
  method: string
  headers: Record<string, string>
  url: string
  constructor(method: string, url: string, headers: Record<string, string>, private readonly payload: Uint8Array | string) {
    super()
    this.method = method
    this.url = url
    this.headers = headers
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    yield typeof this.payload === 'string' ? Buffer.from(this.payload) : this.payload
  }
}

function response() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value
    },
    end(body = '') {
      this.body = String(body)
    },
  }
}

describe('model management routes', () => {
  it('uploads a zip via POST /friend/models/upload and lists it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-friend-model-routes-'))
    temporaryRoots.push(root)
    const routes = createModelRoutes({ dataRoot: root })
    const upload = routes.find((route) => route.path === '/friend/models/upload')
    const archive = zipSync({
      'cat/cat.model3.json': strToU8('{"Version":3,"FileReferences":{}}'),
    })
    const uploaded = response()
    await upload?.handler(
      new BodyRequest('POST', '/friend/models/upload?name=cat', {
        'content-type': 'application/zip',
      }, archive) as unknown as IncomingMessage,
      uploaded as unknown as ServerResponse,
    )
    expect(uploaded.statusCode).toBe(200)
    expect(JSON.parse(uploaded.body)).toMatchObject({ ok: true, name: 'cat' })

    const list = routes.find((route) => route.path === '/friend/models')
    const listed = response()
    await list?.handler(
      { method: 'GET', url: '/friend/models' } as IncomingMessage,
      listed as unknown as ServerResponse,
    )
    expect(JSON.parse(listed.body).current).toBe('cat')
  })

  it('rejects POST-less methods on the upload route', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-friend-model-routes-'))
    temporaryRoots.push(root)
    const upload = createModelRoutes({ dataRoot: root }).find((route) => route.path === '/friend/models/upload')
    const res = response()
    await upload?.handler(
      { method: 'GET', url: '/friend/models/upload' } as IncomingMessage,
      res as unknown as ServerResponse,
    )
    expect(res.statusCode).toBe(405)
  })
})
