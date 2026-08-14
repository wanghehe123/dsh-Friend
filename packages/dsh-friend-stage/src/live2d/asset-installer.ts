import { access, cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  createAssetProgressSnapshot,
  type AssetProgressListener,
  type AssetProgressSnapshot,
} from './asset-progress.ts'
import {
  CUBISM_CORE_OFFICIAL_SOURCE_URL,
  HIYORI_OFFICIAL_SOURCE_URL,
  inspectLive2DAssets,
  LIVE2D_VENDOR_NOTICE_RELATIVE_PATH,
  renderVendorNotice,
  type Live2DAssetStatus,
} from './asset-store.ts'
import {
  combineIntegrity,
  integrityFromExpected,
  loadExpectedDigests,
  sha256Hex,
  verifySha256,
  type Live2DExpectedDigests,
  type Live2DIntegrity,
} from './integrity.ts'
import {
  CUBISM_SDK_RELEASE,
  CUBISM_SDK_RELEASE_RELATIVE_PATH,
} from './asset-layout.ts'
import {
  extractZipToDirectory,
  isHiyoriFreeEntry,
  pickCubismCorePayload,
  unzipSafe,
  isCubismCoreEntry,
} from './unzip-safe.ts'

export type OfficialAssetDownloader = (url: string, onChunk?: DownloadProgress) => Promise<Uint8Array>
export type DownloadProgress = (downloadedBytes: number, totalBytes: number) => void
export type HiyoriFreeExtractor = (archive: Uint8Array, destination: string) => Promise<void>
export type CubismCoreExtractor = (archive: Uint8Array) => Promise<Uint8Array>

/** Only these trees are owned by the official installer. Never rm `vendor/` itself. */
export const MANAGED_VENDOR_RELATIVE_DIRS = {
  model: 'vendor/hiyori',
  core: 'vendor/cubism-core',
} as const

export type Live2DInstallResult = Live2DAssetStatus & {
  integrity: Live2DIntegrity
  actualSha256: Readonly<{
    hiyoriZip?: string
    cubismSdkZip?: string
    cubismCoreJs?: string
  }>
}

export type OfficialLive2DInstallOptions = Readonly<{
  dataRoot: string
  /** Explicit UI confirmation; no network request occurs before this is true. */
  licenseAccepted: boolean
  download?: OfficialAssetDownloader
  extractHiyoriFree?: HiyoriFreeExtractor
  extractCubismCore?: CubismCoreExtractor
  now?: () => Date
  onProgress?: AssetProgressListener
  expectedDigests?: Live2DExpectedDigests
}>

/**
 * Download the official Hiyori FREE runtime and official hosted Cubism Core.
 *
 * Archives are hashed before anything is written under `vendor/`. Staging
 * lives in a temp directory; managed partial trees (`vendor/hiyori`,
 * `vendor/cubism-core`) are removed automatically so a failed run is retryable.
 */
export async function installOfficialLive2DAssets(
  options: OfficialLive2DInstallOptions,
): Promise<Live2DInstallResult> {
  if (!options.licenseAccepted) {
    throw new Error('Live2D license acceptance is required before downloading official assets')
  }

  const expected = options.expectedDigests ?? loadExpectedDigests()
  const publish = (snapshot: AssetProgressSnapshot): void => {
    options.onProgress?.(snapshot)
  }
  const bytes = { downloadedBytes: 0, totalBytes: 0 }

  const before = await inspectLive2DAssets(options.dataRoot)
  if (before.ready) {
    await writeVendorNotice(options.dataRoot, options.now)
    const integrity = integrityFromExpected(expected)
    const ready = withIntegrity(before, integrity, {})
    publish(createAssetProgressSnapshot({
      phase: 'ready',
      downloadedBytes: 0,
      totalBytes: 0,
      hashPending: integrity === 'hash-pending',
    }))
    return ready
  }

  await recoverManagedPartials(options.dataRoot, before.missing)

  const needsModel = before.missing.includes('model')
  const needsCore = before.missing.includes('core')
  const download = options.download ?? downloadOfficialAsset
  const extractHiyoriFree = options.extractHiyoriFree ?? extractOfficialHiyoriFree
  const extractCubismCore = options.extractCubismCore ?? extractOfficialCubismCore
  const stagingRoot = await mkdtemp(join(tmpdir(), 'dsh-friend-live2d-'))
  const actualSha256: { hiyoriZip?: string; cubismSdkZip?: string; cubismCoreJs?: string } = {}
  const integrityParts: Live2DIntegrity[] = []

  const parts = {
    hiyori: { downloaded: 0, total: 0 },
    cubism: { downloaded: 0, total: 0 },
  }
  const emitDownload = (): void => {
    bytes.downloadedBytes = parts.hiyori.downloaded + parts.cubism.downloaded
    bytes.totalBytes = parts.hiyori.total + parts.cubism.total
    publish(createAssetProgressSnapshot({
      phase: 'downloading',
      downloadedBytes: bytes.downloadedBytes,
      totalBytes: bytes.totalBytes,
      hashPending: false,
    }))
  }

  try {
    publish(createAssetProgressSnapshot({
      phase: 'downloading',
      downloadedBytes: 0,
      totalBytes: 0,
      hashPending: false,
    }))

    const [hiyoriArchive, cubismSdkArchive] = await Promise.all([
      needsModel
        ? download(HIYORI_OFFICIAL_SOURCE_URL, (downloaded, total) => {
          parts.hiyori = { downloaded, total }
          emitDownload()
        })
        : Promise.resolve(undefined),
      needsCore
        ? download(CUBISM_CORE_OFFICIAL_SOURCE_URL, (downloaded, total) => {
          parts.cubism = { downloaded, total }
          emitDownload()
        })
        : Promise.resolve(undefined),
    ])

    publish(createAssetProgressSnapshot({
      phase: 'verifying',
      downloadedBytes: bytes.downloadedBytes,
      totalBytes: bytes.totalBytes,
      hashPending: false,
    }))

    if (hiyoriArchive) {
      const digest = sha256Hex(hiyoriArchive)
      actualSha256.hiyoriZip = digest
      integrityParts.push(verifySha256(digest, expected.hiyoriZipSha256, 'Hiyori zip'))
    }
    if (cubismSdkArchive) {
      const digest = sha256Hex(cubismSdkArchive)
      actualSha256.cubismSdkZip = digest
      integrityParts.push(verifySha256(digest, expected.cubismSdkZipSha256, 'Cubism SDK zip'))
    }

    publish(createAssetProgressSnapshot({
      phase: 'extracting',
      downloadedBytes: bytes.downloadedBytes,
      totalBytes: bytes.totalBytes,
      hashPending: integrityParts.includes('hash-pending'),
    }))

    let extractedHiyoriRoot: string | undefined
    if (hiyoriArchive) {
      extractedHiyoriRoot = join(stagingRoot, 'hiyori')
      await extractHiyoriFree(hiyoriArchive, extractedHiyoriRoot)
      await assertHiyoriFreeLayout(extractedHiyoriRoot)
    }

    const cubismCore = cubismSdkArchive ? await extractCubismCore(cubismSdkArchive) : undefined
    if (cubismCore) {
      const digest = sha256Hex(cubismCore)
      actualSha256.cubismCoreJs = digest
      integrityParts.push(verifySha256(digest, expected.cubismCoreJsSha256, 'Cubism Core JS'))
      if (integrityParts.includes('hash-pending')) {
        assertCubismCorePayload(cubismCore)
      }
    }

    const integrity = combineIntegrity(integrityParts)

    publish(createAssetProgressSnapshot({
      phase: 'finalizing',
      downloadedBytes: bytes.downloadedBytes,
      totalBytes: bytes.totalBytes,
      hashPending: integrity === 'hash-pending',
    }))

    if (extractedHiyoriRoot) {
      const hiyoriTarget = join(options.dataRoot, 'vendor/hiyori/hiyori_free')
      await mkdir(dirname(hiyoriTarget), { recursive: true })
      await movePath(join(extractedHiyoriRoot, 'hiyori_free'), hiyoriTarget)
    }

    if (cubismCore) {
      const coreDirectory = dirname(before.corePath)
      await mkdir(coreDirectory, { recursive: true })
      const pendingCore = join(coreDirectory, `.live2dcubismcore-${process.pid}-${Date.now()}.tmp`)
      await writeFile(pendingCore, cubismCore)
      await rename(pendingCore, before.corePath)
      await writeFile(join(options.dataRoot, CUBISM_SDK_RELEASE_RELATIVE_PATH), `${CUBISM_SDK_RELEASE}\n`, 'utf8')
    }

    await writeVendorNotice(options.dataRoot, options.now)

    const after = await inspectLive2DAssets(options.dataRoot)
    if (!after.ready) {
      throw new Error(`Official Live2D asset installation is incomplete: ${after.missing.join(', ')}`)
    }
    const result = withIntegrity(after, integrity, actualSha256)
    publish(createAssetProgressSnapshot({
      phase: 'ready',
      downloadedBytes: bytes.downloadedBytes,
      totalBytes: bytes.totalBytes,
      hashPending: integrity === 'hash-pending',
    }))
    return result
  } catch (error) {
    publish(createAssetProgressSnapshot({
      phase: 'error',
      downloadedBytes: bytes.downloadedBytes,
      totalBytes: bytes.totalBytes,
      hashPending: false,
      error: error instanceof Error ? error.message : String(error),
    }))
    throw error
  } finally {
    await rm(stagingRoot, { recursive: true, force: true })
  }
}

export async function extractOfficialHiyoriFree(archive: Uint8Array, destination: string): Promise<void> {
  await extractZipToDirectory(archive, destination, isHiyoriFreeEntry)
}

export function extractOfficialCubismCore(archive: Uint8Array): Uint8Array {
  const entries = unzipSafe(archive, isCubismCoreEntry)
  return pickCubismCorePayload(entries)
}

export async function recoverManagedPartials(
  dataRoot: string,
  missing: readonly ('model' | 'core')[],
): Promise<void> {
  for (const key of missing) {
    await rm(join(dataRoot, MANAGED_VENDOR_RELATIVE_DIRS[key]), { recursive: true, force: true })
  }
}

async function downloadOfficialAsset(url: string, onChunk?: DownloadProgress): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Official Live2D asset download failed (${response.status}) for ${url}`)
  }
  const listed = Number(response.headers.get('content-length'))
  const total = Number.isFinite(listed) && listed > 0 ? listed : 0
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    onChunk?.(bytes.byteLength, total || bytes.byteLength)
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let downloaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    downloaded += value.byteLength
    onChunk?.(downloaded, total)
  }
  return concatBytes(chunks, downloaded)
}

function concatBytes(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function movePath(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EXDEV') throw error
    await cp(src, dest, { recursive: true })
    await rm(src, { recursive: true, force: true })
  }
}

async function assertHiyoriFreeLayout(extractedRoot: string): Promise<void> {
  const modelPath = join(extractedRoot, 'hiyori_free/runtime/hiyori_free_t08.model3.json')
  if (!await pathExists(modelPath)) {
    throw new Error('Official Hiyori archive did not contain the expected FREE runtime model')
  }
}

function assertCubismCorePayload(payload: Uint8Array): void {
  const preview = new TextDecoder().decode(payload.subarray(0, 1024))
  if (!preview.includes('Live2D Cubism Core')) {
    throw new Error('Official Cubism Core download did not contain the expected runtime header')
  }
}

function withIntegrity(
  status: Live2DAssetStatus,
  integrity: Live2DIntegrity,
  actualSha256: Live2DInstallResult['actualSha256'],
): Live2DInstallResult {
  return { ...status, integrity, actualSha256 }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function writeVendorNotice(dataRoot: string, now: (() => Date) | undefined): Promise<void> {
  const noticePath = join(dataRoot, LIVE2D_VENDOR_NOTICE_RELATIVE_PATH)
  await mkdir(dirname(noticePath), { recursive: true })
  await writeFile(noticePath, renderVendorNotice((now ?? (() => new Date()))().toISOString()), 'utf8')
}
