import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

type Response = {
  statusCode: number
  headers: Record<string, string>
  body: string
  setHeader: (name: string, value: string) => void
  end: (body?: string) => void
}

type Route = {
  kind: 'exact' | 'prefix'
  path: string
  handler: (request: { url?: string; method?: string }, response: Response) => void | Promise<void>
}

type InstalledModel = {
  name: string
  kind: 'builtin' | 'user'
  model3Relative: string
  modelUrl: string
}

type StageModule = {
  createStageRoutes: (options?: {
    dataRoot?: string
    assetStore?: {
      inspect: () => Promise<{ ready: boolean; missing: readonly string[] }>
      install: (licenseAccepted: boolean) => Promise<{ ready: boolean; missing: readonly string[] }>
    }
    resolveTargetFps?: () => number
    resolveCoreEnabled?: () => boolean
    resolveCurrentModel?: () => Promise<InstalledModel>
  }) => readonly Route[]
}

const builtinHiyori: InstalledModel = {
  name: 'hiyori',
  kind: 'builtin',
  model3Relative: 'vendor/hiyori/hiyori_free/runtime/hiyori_free_t08.model3.json',
  modelUrl: '/friend/assets/vendor/hiyori/hiyori_free/runtime/hiyori_free_t08.model3.json',
}

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function loadStage(): Promise<StageModule | undefined> {
  try {
    return await import(/* @vite-ignore */ new URL('../src/index.ts', import.meta.url).href) as StageModule
  } catch {
    return undefined
  }
}

function createResponse(): Response {
  const response: Response = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(body = '') {
      this.body = body
    },
  }
  return response
}

describe('stage routes', () => {
  const readyAssets = {
    inspect: async () => ({ ready: true, missing: [] }),
    install: async () => ({ ready: true, missing: [] }),
  }

  it('provides a self-contained, transparent-capable Live2D page when assets are installed', async () => {
    const stage = await loadStage()

    expect(stage, 'stage host entry must export its routes').toBeDefined()
    const pet = stage?.createStageRoutes({
      assetStore: readyAssets,
      resolveCurrentModel: async () => builtinHiyori,
    }).find((route) => route.path === '/friend/pet')
    expect(pet).toMatchObject({ kind: 'exact', path: '/friend/pet' })

    const response = createResponse()
    await pet?.handler({ method: 'GET', url: '/friend/pet?transparent=1' }, response)

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.body).toContain('data-transparent="true"')
    expect(response.body).toContain('data-live2d-state="ready"')
    expect(response.body).toContain('<canvas id="friend-live2d"')
    expect(response.body).toContain('/friend/assets/vendor/cubism-core/live2dcubismcore.min.js')
    expect(response.body).toContain('/friend/assets/vendor/hiyori/hiyori_free/runtime/hiyori_free_t08.model3.json')
    expect(response.body).toContain('/friend/stage/pet.iife.js')
    expect(response.body).toContain('data-expression="happy"')
    expect(response.body).toContain('data-expression="sleepy"')
    expect(response.body).toContain('"targetFps":30')
    expect(response.body).toContain('new EventSource')
    expect(response.body).toContain('/friend/events')
    expect(response.body).toContain('/friend/stage/performance')
    expect(response.body).toContain('friend-sse-state')
    expect(response.body).toContain('data-friend-bubble')
    expect(response.body).toContain('/friend/stage/chat')
    expect(response.body).toContain('readyState === 2')
    expect(response.body).toContain('data-embed="false"')
    expect(response.body).toContain('/friend/stage/runtime')
    expect(response.body).toContain('setTargetFps')
    expect(response.body).toContain('id="friend-voice"')
    expect(response.body).not.toContain('webkitSpeechRecognition')
    expect(response.body).not.toMatch(/new Speech\s*\(/)
  })

  it('embeds the selected user model and friend.map.json on the pet page', async () => {
    const stage = await loadStage()
    const root = await mkdtemp(join(tmpdir(), 'dsh-friend-pet-map-'))
    temporaryRoots.push(root)
    const modelDir = join(root, 'models/export-v3')
    await mkdir(modelDir, { recursive: true })
    await writeFile(join(modelDir, 'naiwa-live2d-v3.model3.json'), JSON.stringify({
      Version: 3,
      FileReferences: {
        Expressions: [{ Name: 'smile', File: 'expressions/smile.exp3.json' }],
        Motions: { Idle: [{ File: 'motions/idle.motion3.json' }] },
      },
    }))
    await writeFile(join(root, 'models/catalog.json'), JSON.stringify({ current: 'export-v3' }))

    const pet = stage?.createStageRoutes({
      dataRoot: root,
      assetStore: readyAssets,
    }).find((route) => route.path === '/friend/pet')
    const response = createResponse()
    await pet?.handler({ method: 'GET', url: '/friend/pet' }, response)

    expect(response.body).toContain('/friend/assets/models/export-v3/naiwa-live2d-v3.model3.json')
    expect(response.body).toContain('"mouthOpenParam":"ParamMouthOpenY"')
    expect(response.body).toContain('expressions/smile.exp3.json')
    expect(response.body).toContain('motions/idle.motion3.json')
    expect(response.body).not.toContain('/friend/assets/vendor/hiyori/hiyori_free/runtime/hiyori_free_t08.model3.json')
  })

  it('renders an embeddable transparent pet page for the in-page iframe', async () => {
    const stage = await loadStage()
    const pet = stage?.createStageRoutes({
      assetStore: readyAssets,
      resolveCurrentModel: async () => builtinHiyori,
    }).find((route) => route.path === '/friend/pet')
    const response = createResponse()
    await pet?.handler({ method: 'GET', url: '/friend/pet?transparent=1&embed=1' }, response)
    expect(response.body).toContain('data-transparent="true"')
    expect(response.body).toContain('data-embed="true"')
    expect(response.body).toContain('html[data-embed="true"] .toolbar { display: none; }')
    expect(response.body).not.toContain('data-friend-bubble')
    expect(response.body).not.toContain('/friend/stage/chat')
    expect(response.body).toContain('/friend/stage/pet.iife.js')
  })

  it('embeds a configured FPS cap and serves installer SSE wiring when assets are missing', async () => {
    const stage = await loadStage()
    expect(stage, 'stage host entry must export its routes').toBeDefined()

    const ready = stage?.createStageRoutes({
      assetStore: readyAssets,
      resolveTargetFps: () => 24,
      resolveCurrentModel: async () => builtinHiyori,
    }).find((route) => route.path === '/friend/pet')
    const readyResponse = createResponse()
    await ready?.handler({ method: 'GET', url: '/friend/pet' }, readyResponse)
    expect(readyResponse.body).toContain('"targetFps":24')

    const missingAssets = {
      inspect: async () => ({ ready: false, missing: ['model', 'core'] }),
      install: async () => ({ ready: true, missing: [] }),
    }
    const pet = stage?.createStageRoutes({ assetStore: missingAssets }).find((route) => route.path === '/friend/pet')
    const response = createResponse()
    await pet?.handler({ method: 'GET', url: '/friend/pet' }, response)
    expect(response.body).toContain('new EventSource')
    expect(response.body).toContain('/friend/events')
    expect(response.body).toContain('/friend/live2d/progress')
    expect(response.body).toContain('asset-progress')
  })

  it('exposes a runtime snapshot for enabled + targetFps so a live pet can follow settings', async () => {
    const stage = await loadStage()
    const runtime = stage?.createStageRoutes({
      assetStore: readyAssets,
      resolveTargetFps: () => 24,
      resolveCoreEnabled: () => false,
    }).find((route) => route.path === '/friend/stage/runtime')
    expect(runtime).toMatchObject({ kind: 'exact', path: '/friend/stage/runtime' })

    const response = createResponse()
    await runtime?.handler({ method: 'GET', url: '/friend/stage/runtime' }, response)
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ enabled: false, targetFps: 24 })
  })

  it('exposes a machine-readable health check with Live2D asset status', async () => {
    const stage = await loadStage()

    expect(stage, 'stage host entry must export its routes').toBeDefined()
    const health = stage?.createStageRoutes({ assetStore: readyAssets }).find((route) => route.path === '/friend/health')
    expect(health).toMatchObject({ kind: 'exact', path: '/friend/health' })

    const response = createResponse()
    await health?.handler({ method: 'GET', url: '/friend/health' }, response)

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/json')
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      stage: 'live2d',
      assetMode: 'ready',
      missing: [],
    })
  })
})
