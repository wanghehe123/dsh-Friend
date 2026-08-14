import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  HIYORI_OFFICIAL_SOURCE_URL,
  CUBISM_CORE_OFFICIAL_SOURCE_URL,
  inspectLive2DAssets,
  renderVendorNotice,
  resolveFriendDataRoot,
} from '../../src/live2d/asset-store.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('official Live2D asset store', () => {
  it('uses the active DSH data home instead of putting official sample files in the package', () => {
    expect(resolveFriendDataRoot({ DSH_HOME: '/tmp/dsh-profile' }, '/Users/example'))
      .toBe('/tmp/dsh-profile/friend')
    expect(resolveFriendDataRoot({}, '/Users/example')).toBe('/Users/example/.dsh/friend')
  })

  it('honors FRIEND_DATA_DIR and resolves a relative DSH_HOME', () => {
    expect(resolveFriendDataRoot({
      FRIEND_DATA_DIR: '/tmp/friend-isolated',
      DSH_HOME: '/tmp/dsh-profile',
    }, '/Users/example')).toBe('/tmp/friend-isolated')
    expect(resolveFriendDataRoot({ DSH_HOME: 'relative-dsh' }, '/Users/example'))
      .toBe(join(resolve('relative-dsh'), 'friend'))
  })

  it('reports the model and Core as ready only after both expected files are present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-friend-stage-assets-'))
    temporaryRoots.push(root)

    expect(await inspectLive2DAssets(root)).toMatchObject({
      ready: false,
      missing: ['model', 'core'],
    })

    const model = join(root, 'vendor/hiyori/hiyori_free/runtime/hiyori_free_t08.model3.json')
    const core = join(root, 'vendor/cubism-core/live2dcubismcore.min.js')
    await mkdir(join(root, 'vendor/hiyori/hiyori_free/runtime'), { recursive: true })
    await mkdir(join(root, 'vendor/cubism-core'), { recursive: true })
    await writeFile(model, '{}')
    await writeFile(core, '/* Live2D Cubism Core */')
    await writeFile(join(root, 'vendor/cubism-core/sdk-release.txt'), 'CubismSdkForWeb-5-r.5\n')

    expect(await inspectLive2DAssets(root)).toMatchObject({
      ready: true,
      missing: [],
      modelPath: model,
      corePath: core,
    })
  })

  it('treats a Cubism 4 Core leftover as missing so the installer can replace it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-friend-stage-assets-'))
    temporaryRoots.push(root)
    const model = join(root, 'vendor/hiyori/hiyori_free/runtime/hiyori_free_t08.model3.json')
    const core = join(root, 'vendor/cubism-core/live2dcubismcore.min.js')
    await mkdir(join(root, 'vendor/hiyori/hiyori_free/runtime'), { recursive: true })
    await mkdir(join(root, 'vendor/cubism-core'), { recursive: true })
    await writeFile(model, '{}')
    await writeFile(core, '/* Live2D Cubism Core 4 */')

    expect(await inspectLive2DAssets(root)).toMatchObject({
      ready: false,
      missing: ['core'],
    })
  })

  it('persists attribution and official source URLs alongside vendor assets', () => {
    const notice = renderVendorNotice('2026-08-14T00:00:00.000Z')

    expect(notice).toContain(HIYORI_OFFICIAL_SOURCE_URL)
    expect(notice).toContain(CUBISM_CORE_OFFICIAL_SOURCE_URL)
    expect(CUBISM_CORE_OFFICIAL_SOURCE_URL).toBe(
      'https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.5.zip',
    )
    expect(notice).toContain('not redistributed')
  })
})
