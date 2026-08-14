import { join } from 'node:path'

export {
  DSH_HOME_ENV,
  FRIEND_DATA_DIR_ENV,
  resolveDshHome,
  resolveFriendDataDir,
  type FriendDataDirEnv,
  type ResolveFriendDataDirOptions,
} from '@wishp3/dsh-friend-shared'

/**
 * Must stay equal to `@wishp3/dsh-friend-persona` `CURRENT_PERSONA_SLUG_FIELD`.
 * Memory cannot import persona (cycle / package boundary); the field name is
 * the settings contract, not a copied allowlist.
 */
export const PERSONA_CURRENT_SLUG_FIELD = 'currentSlug' as const

/** Must stay equal to persona `DEFAULT_PERSONA_SLUG`. */
export const DEFAULT_CHARACTER_SLUG = 'default' as const

export const MEMORY_FILE_NAME = 'MEMORY.md' as const
export const USER_FILE_REL = join('user', 'USER.md')
export const STORY_FILE_NAME = 'story.md' as const
export const BELIEFS_FILE_NAME = 'beliefs.md' as const
export const DAILY_DIR_NAME = 'memory' as const
export const ARCHIVE_DIR_NAME = 'archive' as const
export const IMPORTED_DIR_NAME = 'imported' as const
export const BACKUP_PREFIX = 'MEMORY.md.bak.' as const
export const MAX_MEMORY_BACKUPS = 7
export const DEFAULT_MEMORY_MAX_BYTES = 8 * 1024
export const WATERMARK_FILE_NAME = '.auto-summary.json' as const
export const IMPORT_MARK_FILE_NAME = '.import-kokoro.json' as const

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/

export function assertSafeSlug(slug: string): void {
  if (!SAFE_SLUG.test(slug)) {
    throw new Error(`dsh-friend-memory: illegal character slug "${slug}"`)
  }
}

export function charactersDir(dataDir: string): string {
  return join(dataDir, 'characters')
}

export function characterDir(dataDir: string, slug: string): string {
  assertSafeSlug(slug)
  return join(dataDir, 'characters', slug)
}

export function memoryFilePath(dataDir: string, slug: string): string {
  return join(characterDir(dataDir, slug), MEMORY_FILE_NAME)
}

export function memoryBackupPath(dataDir: string, slug: string, index: number): string {
  return join(characterDir(dataDir, slug), `${BACKUP_PREFIX}${index}`)
}

export function dailyDir(dataDir: string, slug: string): string {
  return join(characterDir(dataDir, slug), DAILY_DIR_NAME)
}

export function dailyNotePath(dataDir: string, slug: string, date: string): string {
  assertDailyDate(date)
  return join(dailyDir(dataDir, slug), `${date}.md`)
}

export function archiveMonthDir(dataDir: string, slug: string, yearMonth: string): string {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw new Error(`dsh-friend-memory: illegal archive month "${yearMonth}"`)
  }
  return join(dailyDir(dataDir, slug), ARCHIVE_DIR_NAME, yearMonth)
}

export function importedNotePath(dataDir: string, slug: string, date: string): string {
  assertDailyDate(date)
  return join(dailyDir(dataDir, slug), IMPORTED_DIR_NAME, `${date}.md`)
}

export function storyFilePath(dataDir: string, slug: string): string {
  return join(characterDir(dataDir, slug), STORY_FILE_NAME)
}

export function beliefsFilePath(dataDir: string, slug: string): string {
  return join(characterDir(dataDir, slug), BELIEFS_FILE_NAME)
}

export function userFilePath(dataDir: string): string {
  return join(dataDir, USER_FILE_REL)
}

export function watermarkPath(dataDir: string, slug: string): string {
  return join(dailyDir(dataDir, slug), WATERMARK_FILE_NAME)
}

export function importMarkPath(dataDir: string): string {
  return join(dataDir, IMPORT_MARK_FILE_NAME)
}

export function assertDailyDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`dsh-friend-memory: illegal daily date "${date}"`)
  }
}

export function formatDay(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatClock(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function addDays(date: Date, delta: number): Date {
  const next = new Date(date.getTime())
  next.setDate(next.getDate() + delta)
  return next
}

export function yearMonthOf(day: string): string {
  assertDailyDate(day)
  return day.slice(0, 7)
}
