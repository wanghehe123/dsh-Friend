import { relative, resolve, sep } from 'node:path'

import { DAILY_DIR_NAME, MEMORY_FILE_NAME, STORY_FILE_NAME, USER_FILE_REL } from './paths.ts'

export class MemoryPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemoryPathError'
  }
}

/**
 * Resolve a tool / browser path against the friend data root.
 * Rejects absolute escapes, `..`, and anything outside the memory file set.
 */
export function resolveMemoryPath(dataDir: string, rawPath: string): string {
  const trimmed = rawPath.trim().replace(/\\/gu, '/')
  if (trimmed.length === 0) {
    throw new MemoryPathError('path is empty')
  }
  if (trimmed.startsWith('/') || /^[a-zA-Z]:\//u.test(trimmed)) {
    throw new MemoryPathError(`path is outside the friend data directory: ${rawPath}`)
  }
  if (trimmed.split('/').includes('..') || trimmed.includes('\0')) {
    throw new MemoryPathError(`path is outside the friend data directory: ${rawPath}`)
  }

  const absolute = resolve(dataDir, trimmed)
  const rel = relative(resolve(dataDir), absolute)
  if (rel.startsWith('..') || rel === '') {
    throw new MemoryPathError(`path is outside the friend data directory: ${rawPath}`)
  }

  const posix = rel.split(sep).join('/')
  if (!isAllowedMemoryRel(posix)) {
    throw new MemoryPathError(`path is not a memory file: ${rawPath}`)
  }
  return absolute
}

export function toDataRel(dataDir: string, absolute: string): string {
  return relative(resolve(dataDir), resolve(absolute)).split(sep).join('/')
}

export function isAllowedMemoryRel(posix: string): boolean {
  if (posix === MEMORY_FILE_NAME || posix.endsWith(`/${MEMORY_FILE_NAME}`)) {
    return true
  }
  if (posix === USER_FILE_REL || posix === 'USER.md') {
    return true
  }
  if (posix === STORY_FILE_NAME || posix.endsWith(`/${STORY_FILE_NAME}`)) {
    return true
  }
  if (posix.includes(`/${DAILY_DIR_NAME}/`) || posix.startsWith(`${DAILY_DIR_NAME}/`)) {
    return posix.endsWith('.md')
  }
  return false
}
