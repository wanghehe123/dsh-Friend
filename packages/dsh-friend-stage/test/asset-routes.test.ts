import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createStageRoutes } from '../src/index.ts'

type Response = {
  statusCode: number
  headers: Record<string, string>
  body: Buffer
  setHeader(name: string, value: string): void
  end(body?: string | Buffer): void
}

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function response(): Response {
  return {
    statusCode: 0,
    headers: {},
    body: Buffer.alloc(0),
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(body = '') {
      this.body = Buffer.isBuffer(body) ? body : Buffer.from(body)
    },
  }
}

describe('Live2D asset routes', () => {
  it('serves local Core and pet bundle without caching stale runtime code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-friend-assets-route-'))
    temporaryRoots.push(root)
    const corePath = join(root, 'vendor/cubism-core/live2dcubismcore.min.js')
    const petBundlePath = join(root, 'pet.iife.js')
    await mkdir(dirname(corePath), { recursive: true })
    await writeFile(corePath, '/* Live2D Cubism Core */')
    await writeFile(petBundlePath, 'window.DshFriendPet = {};')

    const routes = createStageRoutes({ dataRoot: root, petBundlePath })
    const asset = routes.find((route) => route.path === '/friend/assets')
    const bundle = routes.find((route) => route.path === '/friend/stage/pet.iife.js')
    expect(asset).toBeDefined()
    expect(bundle).toBeDefined()

    const coreResponse = response()
    await asset?.handler({ method: 'GET', url: '/friend/assets/vendor/cubism-core/live2dcubismcore.min.js' } as never, coreResponse as never)
    expect(coreResponse.statusCode).toBe(200)
    expect(coreResponse.headers['content-type']).toContain('application/javascript')
    expect(coreResponse.headers['cache-control']).toBe('no-store')
    expect(coreResponse.body.toString()).toContain('Live2D Cubism Core')

    const bundleResponse = response()
    await bundle?.handler({ method: 'GET', url: '/friend/stage/pet.iife.js' } as never, bundleResponse as never)
    expect(bundleResponse.statusCode).toBe(200)
    expect(bundleResponse.body.toString()).toContain('DshFriendPet')
  })

  it('createStageRoutes without dataRoot reads FRIEND_DATA_DIR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-friend-assets-env-'))
    temporaryRoots.push(root)
    const corePath = join(root, 'vendor/cubism-core/live2dcubismcore.min.js')
    await mkdir(dirname(corePath), { recursive: true })
    await writeFile(corePath, '/* from FRIEND_DATA_DIR */')

    const previousFriend = process.env.FRIEND_DATA_DIR
    const previousDsh = process.env.DSH_HOME
    process.env.FRIEND_DATA_DIR = root
    delete process.env.DSH_HOME
    try {
      const routes = createStageRoutes()
      const asset = routes.find((route) => route.path === '/friend/assets')
      const coreResponse = response()
      await asset?.handler(
        { method: 'GET', url: '/friend/assets/vendor/cubism-core/live2dcubismcore.min.js' } as never,
        coreResponse as never,
      )
      expect(coreResponse.statusCode).toBe(200)
      expect(coreResponse.body.toString()).toContain('from FRIEND_DATA_DIR')
    } finally {
      if (previousFriend === undefined) delete process.env.FRIEND_DATA_DIR
      else process.env.FRIEND_DATA_DIR = previousFriend
      if (previousDsh === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousDsh
    }
  })

  it('returns 403 for encoded and raw path traversal of /friend/assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-friend-assets-route-'))
    temporaryRoots.push(root)
    const routes = createStageRoutes({ dataRoot: root })
    const asset = routes.find((route) => route.path === '/friend/assets')
    const urls = [
      '/friend/assets/../../etc/passwd',
      '/friend/assets/%2e%2e%2fetc/passwd',
      '/friend/assets/vendor/%2e%2e/%2e%2e/etc/passwd',
      '/friend/assets/vendor%2F..%2Fsecret.txt',
    ]

    for (const url of urls) {
      const traversalResponse = response()
      await asset?.handler({ method: 'GET', url } as never, traversalResponse as never)
      expect(traversalResponse.statusCode, url).toBe(403)
    }
  })

  it('returns 405 when the asset prefix is requested with a non-GET method', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-friend-assets-route-'))
    temporaryRoots.push(root)
    const routes = createStageRoutes({ dataRoot: root })
    const asset = routes.find((route) => route.path === '/friend/assets')
    const methodResponse = response()

    await asset?.handler(
      { method: 'POST', url: '/friend/assets/vendor/cubism-core/live2dcubismcore.min.js' } as never,
      methodResponse as never,
    )
    expect(methodResponse.statusCode).toBe(405)
  })

  it('returns a reentrant idle progress snapshot before install starts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-friend-assets-route-'))
    temporaryRoots.push(root)
    const routes = createStageRoutes({ dataRoot: root })
    const progress = routes.find((route) => route.path === '/friend/live2d/progress')
    const progressResponse = response()
    await progress?.handler({ method: 'GET', url: '/friend/live2d/progress' } as never, progressResponse as never)
    expect(progressResponse.statusCode).toBe(200)
    expect(JSON.parse(progressResponse.body.toString())).toEqual({
      phase: 'idle',
      downloadedBytes: 0,
      totalBytes: 0,
      percent: 0,
      hashPending: false,
    })
  })
})

function dirname(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}
