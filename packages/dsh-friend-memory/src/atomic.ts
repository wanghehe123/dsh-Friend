import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type AtomicWriteHooks = {
  /**
   * Test seam: invoked after the temp file is durable and before rename.
   * Throwing here leaves the destination untouched (crash-during-write).
   */
  beforeRename?: (tmpPath: string, destPath: string) => void | Promise<void>
}

const fileLocks = new Map<string, Promise<void>>()

/**
 * Serialize work on one absolute path so two appenders cannot interleave
 * read-modify-write. The lock is process-local (one dsh host).
 */
export async function withFileLock<T>(filePath: string, work: () => Promise<T>): Promise<T> {
  const previous = fileLocks.get(filePath) ?? Promise.resolve()
  let release = (): void => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => current, () => current)
  fileLocks.set(filePath, tail)
  try {
    await previous
    return await work()
  } finally {
    release()
    if (fileLocks.get(filePath) === tail) {
      fileLocks.delete(filePath)
    }
  }
}

/**
 * Write `contents` by creating a sibling temp file then `rename`.
 * POSIX rename on the same volume is atomic: readers see the old file or
 * the new file, never a torn `MEMORY.md`.
 */
export async function atomicWriteFile(
  filePath: string,
  contents: string,
  hooks: AtomicWriteHooks = {},
): Promise<void> {
  const directory = dirname(filePath)
  await mkdir(directory, { recursive: true })
  const tmpPath = `${filePath}.${randomBytes(8).toString('hex')}.tmp`
  try {
    await writeFile(tmpPath, contents, 'utf8')
    if (hooks.beforeRename !== undefined) {
      await hooks.beforeRename(tmpPath, filePath)
    }
    await rename(tmpPath, filePath)
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function lockedAtomicWrite(
  filePath: string,
  contents: string,
  hooks: AtomicWriteHooks = {},
): Promise<void> {
  await withFileLock(filePath, () => atomicWriteFile(filePath, contents, hooks))
}
