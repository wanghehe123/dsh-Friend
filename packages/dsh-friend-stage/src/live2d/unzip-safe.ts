import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

import { unzipSync } from 'fflate'

/** Refuse a single zip entry larger than this (official Core + Hiyori FREE are far smaller). */
export const MAX_ZIP_ENTRY_BYTES = 64 * 1024 * 1024
/** Refuse an archive whose kept entries exceed this uncompressed total. */
export const MAX_ZIP_TOTAL_BYTES = 512 * 1024 * 1024

export class ZipSlipError extends Error {
  readonly entryName: string

  constructor(entryName: string) {
    super(`Refusing zip-slip entry: ${entryName}`)
    this.name = 'ZipSlipError'
    this.entryName = entryName
  }
}

/** Normalize and reject absolute paths, drive letters, and `..` segments. */
export function assertSafeZipPath(entryName: string): string {
  const posix = entryName.replace(/\\/gu, '/')
  if (
    posix.startsWith('/')
    || posix.startsWith('//')
    || /^[a-zA-Z]:/u.test(posix)
    || posix.split('/').includes('..')
  ) {
    throw new ZipSlipError(entryName)
  }
  return posix.replace(/^\.\//u, '')
}

export type ZipKeep = (posixPath: string) => boolean

/**
 * Inflate a zip in memory with zip-slip rejection. `keep` runs after the path
 * is proven safe so callers can drop unused official extra files (Hiyori PRO).
 */
export function unzipSafe(archive: Uint8Array, keep: ZipKeep = () => true): Record<string, Uint8Array> {
  const entries = unzipSync(archive, {
    filter(file) {
      const posix = assertSafeZipPath(file.name)
      if (file.originalSize > MAX_ZIP_ENTRY_BYTES) {
        throw new Error(`Zip entry exceeds size limit: ${file.name}`)
      }
      return keep(posix) && !posix.endsWith('/')
    },
  })

  const out: Record<string, Uint8Array> = {}
  let total = 0
  for (const [name, data] of Object.entries(entries)) {
    const posix = assertSafeZipPath(name)
    total += data.byteLength
    if (total > MAX_ZIP_TOTAL_BYTES) {
      throw new Error('Zip archive exceeds uncompressed size limit')
    }
    out[posix] = data
  }
  return out
}

/** Write kept zip entries under `destination`, re-checking the resolved path. */
export async function extractZipToDirectory(
  archive: Uint8Array,
  destination: string,
  keep: ZipKeep = () => true,
): Promise<void> {
  const entries = unzipSafe(archive, keep)
  const root = resolve(destination)
  await mkdir(root, { recursive: true })
  for (const [posix, data] of Object.entries(entries)) {
    if (posix.endsWith('/')) continue
    const dest = resolve(root, posix)
    const fromRoot = relative(root, dest)
    if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw new ZipSlipError(posix)
    }
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, data)
  }
}

export function isHiyoriFreeEntry(posixPath: string): boolean {
  return posixPath === 'hiyori_free' || posixPath.startsWith('hiyori_free/')
}

export function isCubismCoreEntry(posixPath: string): boolean {
  return posixPath.replace(/\\/gu, '/').endsWith('Core/live2dcubismcore.min.js')
}

export const CUBISM_CORE_ARCHIVE_ENTRY = 'CubismSdkForWeb-4-r.7/Core/live2dcubismcore.min.js'

export function pickCubismCorePayload(entries: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const exact = entries[CUBISM_CORE_ARCHIVE_ENTRY]
  if (exact) return exact
  for (const [name, data] of Object.entries(entries)) {
    if (isCubismCoreEntry(name)) return data
  }
  throw new Error('Official Cubism SDK archive did not contain live2dcubismcore.min.js')
}
