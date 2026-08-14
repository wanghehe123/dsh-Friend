import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  extractOfficialCubismCore,
  extractOfficialHiyoriFree,
  installOfficialLive2DAssets,
} from '../../src/live2d/asset-installer.ts'
import { sha256Hex } from '../../src/live2d/integrity.ts'
import { ZipSlipError } from '../../src/live2d/unzip-safe.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-friend-installer-'))
  temporaryRoots.push(root)
  return root
}

const zipPlaceholder = new TextEncoder().encode('zip-placeholder')
const cubismCoreSource = new TextEncoder().encode('/* Live2D Cubism Core */')

describe('official Live2D installer', () => {
  it('refuses to fetch material until the license checkbox has been accepted', async () => {
    const root = await tempRoot()
    const download = vi.fn(async () => new Uint8Array())

    await expect(installOfficialLive2DAssets({
      dataRoot: root,
      licenseAccepted: false,
      download,
    })).rejects.toThrow('Live2D license acceptance is required')
    expect(download).not.toHaveBeenCalled()
  })

  it('installs only Hiyori FREE runtime files, official Core, and a local NOTICE', async () => {
    const root = await tempRoot()
    const download = vi.fn(async () => zipPlaceholder)
    const extractCubismCore = vi.fn(async () => cubismCoreSource)
    const snapshots: Array<{ phase: string; percent: number; downloadedBytes: number; totalBytes: number }> = []

    const status = await installOfficialLive2DAssets({
      dataRoot: root,
      licenseAccepted: true,
      download,
      extractHiyoriFree: async (_archive, destination) => {
        const runtime = join(destination, 'hiyori_free/runtime')
        await mkdir(runtime, { recursive: true })
        await writeFile(join(runtime, 'hiyori_free_t08.model3.json'), '{}')
        await writeFile(join(destination, 'hiyori_free/ReadMe.txt'), 'official Hiyori README')
      },
      extractCubismCore,
      now: () => new Date('2026-08-14T00:00:00.000Z'),
      onProgress: (snapshot) => {
        snapshots.push(snapshot)
      },
    })

    expect(status.ready).toBe(true)
    expect(status.integrity).toBe('hash-pending')
    expect(download).toHaveBeenCalledTimes(2)
    expect(download.mock.calls.map(([url]) => url)).toContain(
      'https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.5.zip',
    )
    expect(extractCubismCore).toHaveBeenCalledTimes(1)
    await expect(readFile(join(root, 'vendor/hiyori/hiyori_free/ReadMe.txt'), 'utf8'))
      .resolves.toContain('official Hiyori')
    await expect(readFile(join(root, 'vendor/NOTICE.txt'), 'utf8'))
      .resolves.toContain('not redistributed')
    expect(snapshots.at(-1)).toMatchObject({ phase: 'ready', percent: 100 })
    for (const snapshot of snapshots) {
      expect(snapshot).toEqual(expect.objectContaining({
        phase: expect.any(String),
        downloadedBytes: expect.any(Number),
        totalBytes: expect.any(Number),
        percent: expect.any(Number),
        hashPending: expect.any(Boolean),
      }))
      expect(snapshot).not.toHaveProperty('deltaBytes')
    }

    download.mockClear()
    await installOfficialLive2DAssets({
      dataRoot: root,
      licenseAccepted: true,
      download,
      now: () => new Date('2026-08-14T00:01:00.000Z'),
    })
    expect(download).not.toHaveBeenCalled()
    await expect(readFile(join(root, 'vendor/NOTICE.txt'), 'utf8'))
      .resolves.toContain('Installed at: 2026-08-14T00:01:00.000Z')
  })

  it('does not write vendor/ when a filled sha256 does not match', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'vendor'), { recursive: true })
    await writeFile(join(root, 'vendor/user-notes.txt'), 'keep me')

    await expect(installOfficialLive2DAssets({
      dataRoot: root,
      licenseAccepted: true,
      download: async () => zipPlaceholder,
      extractHiyoriFree: async () => {
        throw new Error('extract must not run after a zip hash mismatch')
      },
      extractCubismCore: async () => {
        throw new Error('extract must not run after a zip hash mismatch')
      },
      expectedDigests: {
        hiyoriZipSha256: 'a'.repeat(64),
        cubismSdkZipSha256: 'b'.repeat(64),
        cubismCoreJsSha256: 'c'.repeat(64),
      },
    })).rejects.toThrow(/sha256 mismatch/)

    await expect(readFile(join(root, 'vendor/user-notes.txt'), 'utf8')).resolves.toBe('keep me')
    await expect(readFile(join(root, 'vendor/hiyori/hiyori_free/runtime/hiyori_free_t08.model3.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(root, 'vendor/cubism-core/live2dcubismcore.min.js'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('records verified integrity when expected digests match', async () => {
    const root = await tempRoot()
    const coreBytes = cubismCoreSource
    const status = await installOfficialLive2DAssets({
      dataRoot: root,
      licenseAccepted: true,
      download: async () => zipPlaceholder,
      extractHiyoriFree: async (_archive, destination) => {
        const runtime = join(destination, 'hiyori_free/runtime')
        await mkdir(runtime, { recursive: true })
        await writeFile(join(runtime, 'hiyori_free_t08.model3.json'), '{}')
      },
      extractCubismCore: async () => coreBytes,
      expectedDigests: {
        hiyoriZipSha256: sha256Hex(zipPlaceholder),
        cubismSdkZipSha256: sha256Hex(zipPlaceholder),
        cubismCoreJsSha256: sha256Hex(coreBytes),
      },
    })
    expect(status.ready).toBe(true)
    expect(status.integrity).toBe('verified')
    expect(status.actualSha256.cubismCoreJs).toBe(sha256Hex(coreBytes))
  })

  it('clears a managed partial Hiyori tree and retries without touching other vendor files', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'vendor/hiyori/hiyori_free'), { recursive: true })
    await writeFile(join(root, 'vendor/hiyori/hiyori_free/junk.txt'), 'partial')
    await mkdir(join(root, 'vendor'), { recursive: true })
    await writeFile(join(root, 'vendor/user-notes.txt'), 'keep me')

    const status = await installOfficialLive2DAssets({
      dataRoot: root,
      licenseAccepted: true,
      download: async () => zipPlaceholder,
      extractHiyoriFree: async (_archive, destination) => {
        const runtime = join(destination, 'hiyori_free/runtime')
        await mkdir(runtime, { recursive: true })
        await writeFile(join(runtime, 'hiyori_free_t08.model3.json'), '{}')
      },
      extractCubismCore: async () => cubismCoreSource,
    })

    expect(status.ready).toBe(true)
    await expect(readFile(join(root, 'vendor/user-notes.txt'), 'utf8')).resolves.toBe('keep me')
    await expect(readFile(join(root, 'vendor/hiyori/hiyori_free/junk.txt'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('extracts Hiyori FREE with fflate and rejects zip-slip entries', async () => {
    const root = await tempRoot()
    const safe = zipSync({
      'hiyori_free/runtime/hiyori_free_t08.model3.json': strToU8('{}'),
      'hiyori_free/ReadMe.txt': strToU8('official'),
      'hiyori_pro/skip-me.txt': strToU8('nope'),
    })
    await extractOfficialHiyoriFree(safe, join(root, 'extracted'))
    await expect(readFile(join(root, 'extracted/hiyori_free/ReadMe.txt'), 'utf8')).resolves.toBe('official')
    await expect(readFile(join(root, 'extracted/hiyori_pro/skip-me.txt'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })

    const slipping = zipSync({
      'hiyori_free/runtime/hiyori_free_t08.model3.json': strToU8('{}'),
      'hiyori_free/foo/../../evil.txt': strToU8('nope'),
    })
    await expect(extractOfficialHiyoriFree(slipping, join(root, 'slip'))).rejects.toBeInstanceOf(ZipSlipError)
  })

  it('extracts Cubism Core from the official archive path without spawning unzip', async () => {
    const archive = zipSync({
      'CubismSdkForWeb-5-r.5/Core/live2dcubismcore.min.js': cubismCoreSource,
      'CubismSdkForWeb-5-r.5/README.md': strToU8('sdk'),
    })
    const payload = extractOfficialCubismCore(archive)
    expect(new TextDecoder().decode(payload)).toContain('Live2D Cubism Core')
  })
})
