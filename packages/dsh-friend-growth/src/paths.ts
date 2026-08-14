import { join } from 'node:path'

export {
  resolveFriendDataDir,
  type ResolveFriendDataDirOptions,
} from '@wishp3/dsh-friend-shared'

/** Must stay equal to persona `currentSlug` / memory `DEFAULT_CHARACTER_SLUG`. */
export const PERSONA_CURRENT_SLUG_FIELD = 'currentSlug' as const
export const DEFAULT_CHARACTER_SLUG = 'default' as const

export const STORY_FILE_NAME = 'story.md' as const
export const BELIEFS_FILE_NAME = 'beliefs.md' as const
export const MEMORY_FILE_NAME = 'MEMORY.md' as const
export const GROWTH_DIR_NAME = 'growth' as const
export const PROFILE_FILE_NAME = 'profile.json' as const
export const CURRENT_FILE_NAME = 'current.json' as const
export const PREFERENCES_FILE_NAME = 'preferences.json' as const

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/

export function assertSafeSlug(slug: string): void {
  if (!SAFE_SLUG.test(slug)) {
    throw new Error(`dsh-friend-growth: illegal character slug "${slug}"`)
  }
}

export function characterDir(dataDir: string, slug: string): string {
  assertSafeSlug(slug)
  return join(dataDir, 'characters', slug)
}

export function growthRoot(dataDir: string, slug: string): string {
  return join(characterDir(dataDir, slug), GROWTH_DIR_NAME)
}

export function growthProfilePath(dataDir: string, slug: string): string {
  return join(growthRoot(dataDir, slug), PROFILE_FILE_NAME)
}

export function growthCurrentPath(dataDir: string, slug: string): string {
  return join(growthRoot(dataDir, slug), CURRENT_FILE_NAME)
}

export function growthPreferencesPath(dataDir: string, slug: string): string {
  return join(growthRoot(dataDir, slug), PREFERENCES_FILE_NAME)
}

export function growthBatchDir(dataDir: string, slug: string, batchId: string): string {
  assertSafeBatchId(batchId)
  return join(growthRoot(dataDir, slug), batchId)
}

export function storyFilePath(dataDir: string, slug: string): string {
  return join(characterDir(dataDir, slug), STORY_FILE_NAME)
}

export function beliefsFilePath(dataDir: string, slug: string): string {
  return join(characterDir(dataDir, slug), BELIEFS_FILE_NAME)
}

export function memoryFilePath(dataDir: string, slug: string): string {
  return join(characterDir(dataDir, slug), MEMORY_FILE_NAME)
}

const SAFE_BATCH = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/

export function assertSafeBatchId(batchId: string): void {
  if (!SAFE_BATCH.test(batchId)) {
    throw new Error(`dsh-friend-growth: illegal batch id "${batchId}"`)
  }
}
