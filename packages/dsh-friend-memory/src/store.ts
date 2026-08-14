import { AsyncLocalStorage } from 'node:async_hooks'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { atomicWriteFile, lockedAtomicWrite, withFileLock, type AtomicWriteHooks } from './atomic.ts'
import {
  addDays,
  archiveMonthDir,
  assertDailyDate,
  assertSafeSlug,
  dailyDir,
  dailyNotePath,
  DEFAULT_CHARACTER_SLUG,
  formatClock,
  formatDay,
  importedNotePath,
  MAX_MEMORY_BACKUPS,
  memoryBackupPath,
  memoryFilePath,
  resolveFriendDataDir,
  userFilePath,
  yearMonthOf,
  type ResolveFriendDataDirOptions,
} from './paths.ts'
import { DEFAULT_MEMORY_SETTINGS } from './settings.ts'

/** Spec / WBS 固定四分节. Migration-plan §5.2 的「关系与约定」以 spec 的「待办与约定」为准. */
export const MEMORY_SECTION_TITLES = ['关于用户', '重要事实', '近期主题', '待办与约定'] as const

export type MemorySectionTitle = (typeof MEMORY_SECTION_TITLES)[number]

export const LONGTERM_SECTION: MemorySectionTitle = '重要事实'

export const DAILY_SOURCES = ['chat', 'note', 'import', 'growth'] as const
export type DailySource = (typeof DAILY_SOURCES)[number]

export type MemorySections = Record<MemorySectionTitle, string>

export type ParsedMemory = {
  preamble: string
  sections: MemorySections
  extras: ReadonlyArray<{ title: string; body: string }>
}

export type DailyEntry = {
  time: string
  source: string
  text: string
}

export type LiveString = string | (() => string)
export type LiveNumber = number | (() => number)

export type MemoryStoreOptions = {
  dataDir: string
  slug?: LiveString
  now?: () => Date
  memoryMaxBytes?: LiveNumber
}

type MemoryIoPin = {
  slug: string
  maxBytes: number
}

/**
 * Pins slug + byte limit for one async operation (and its nested writes).
 * A settings change mid-write cannot retarget the directory or the limit.
 */
const memoryIo = new AsyncLocalStorage<MemoryIoPin>()

export type AppendDailyInput = {
  text: string
  source: DailySource
  date?: string
  time?: string
}

export class MemoryLimitError extends Error {
  readonly bytes: number
  readonly limit: number

  constructor(bytes: number, limit: number) {
    super(`dsh-friend-memory: MEMORY.md is ${bytes} bytes, over the ${limit} byte limit`)
    this.name = 'MemoryLimitError'
    this.bytes = bytes
    this.limit = limit
  }
}

export function createMemoryStore(options: ResolveFriendDataDirOptions & {
  slug?: LiveString
  now?: () => Date
  memoryMaxBytes?: LiveNumber
  dataDir?: string
} = {}): MemoryStore {
  return new MemoryStore({
    dataDir: options.dataDir ?? resolveFriendDataDir(options),
    ...(options.slug !== undefined ? { slug: options.slug } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.memoryMaxBytes !== undefined ? { memoryMaxBytes: options.memoryMaxBytes } : {}),
  })
}

/**
 * File-backed memory. Every public read hits disk — no content cache —
 * so an external editor change is the next bootstrap / search / get.
 *
 * `slug` and `memoryMaxBytes` re-read on each new operation when the
 * constructor received getters. An in-flight write keeps the snapshot
 * captured at its start (see {@link runWithCapturedDir}).
 */
export class MemoryStore {
  readonly dataDir: string
  readonly now: () => Date
  private readonly resolveSlugFn: () => string
  private readonly resolveMaxBytesFn: () => number

  constructor(options: MemoryStoreOptions) {
    this.dataDir = options.dataDir
    this.now = options.now ?? (() => new Date())
    this.resolveSlugFn = () => {
      const slug = readLiveString(options.slug, DEFAULT_CHARACTER_SLUG)
      assertSafeSlug(slug)
      return slug
    }
    this.resolveMaxBytesFn = () => readLiveNumber(
      options.memoryMaxBytes,
      DEFAULT_MEMORY_SETTINGS.memoryMaxBytes,
    )
    this.resolveSlugFn()
  }

  /**
   * Effective character slug: pinned in-flight directory, otherwise the
   * live settings value.
   */
  get slug(): string {
    return memoryIo.getStore()?.slug ?? this.resolveSlugFn()
  }

  get memoryMaxBytes(): number {
    return memoryIo.getStore()?.maxBytes ?? this.resolveMaxBytesFn()
  }

  /**
   * Snapshot slug + byte limit for `work` and every nested store call.
   * Re-entrant: an inner call keeps the outer snapshot so a long pipeline
   * (distill, auto-summary) cannot split across two character directories.
   */
  runWithCapturedDir<T>(work: () => Promise<T>): Promise<T> {
    const existing = memoryIo.getStore()
    if (existing !== undefined) {
      return work()
    }
    return memoryIo.run({
      slug: this.resolveSlugFn(),
      maxBytes: this.resolveMaxBytesFn(),
    }, work)
  }

  memoryPath(): string {
    return memoryFilePath(this.dataDir, this.slug)
  }

  userPath(): string {
    return userFilePath(this.dataDir)
  }

  dailyPath(date = formatDay(this.now())): string {
    return dailyNotePath(this.dataDir, this.slug, date)
  }

  async readMemoryRaw(): Promise<string> {
    return this.runWithCapturedDir(() => readUtf8(this.memoryPath()))
  }

  async readUserRaw(): Promise<string> {
    return readUtf8(this.userPath())
  }

  async readDailyRaw(date = formatDay(this.now())): Promise<string> {
    return this.runWithCapturedDir(() => readUtf8(this.dailyPath(date)))
  }

  async readMemory(): Promise<ParsedMemory> {
    return this.runWithCapturedDir(async () => parseMemoryMarkdown(await this.readMemoryRaw()))
  }

  async writeMemory(parsed: ParsedMemory, hooks: AtomicWriteHooks = {}): Promise<void> {
    return this.runWithCapturedDir(async () => {
      const serialized = serializeMemoryMarkdown(parsed)
      const bytes = Buffer.byteLength(serialized, 'utf8')
      if (bytes > this.memoryMaxBytes) {
        throw new MemoryLimitError(bytes, this.memoryMaxBytes)
      }
      await lockedAtomicWrite(this.memoryPath(), serialized, hooks)
    })
  }

  async writeMemoryRaw(contents: string, hooks: AtomicWriteHooks = {}): Promise<void> {
    return this.runWithCapturedDir(async () => {
      const bytes = Buffer.byteLength(contents, 'utf8')
      if (bytes > this.memoryMaxBytes) {
        throw new MemoryLimitError(bytes, this.memoryMaxBytes)
      }
      await lockedAtomicWrite(this.memoryPath(), contents, hooks)
    })
  }

  async writeUser(contents: string): Promise<void> {
    await lockedAtomicWrite(this.userPath(), contents)
  }

  async measureMemoryBytes(): Promise<number> {
    return this.runWithCapturedDir(async () => Buffer.byteLength(await this.readMemoryRaw(), 'utf8'))
  }

  isMemoryOverLimit(contents: string): boolean {
    return Buffer.byteLength(contents, 'utf8') > this.memoryMaxBytes
  }

  async appendDaily(input: AppendDailyInput): Promise<{ path: string; entry: string }> {
    return this.runWithCapturedDir(async () => {
      const date = input.date ?? formatDay(this.now())
      assertDailyDate(date)
      const time = input.time ?? formatClock(this.now())
      const text = input.text.replace(/\s+/gu, ' ').trim()
      if (text.length === 0) {
        throw new Error('dsh-friend-memory: daily entry text is empty')
      }
      const entry = formatDailyEntry(time, input.source, text)
      const path = this.dailyPath(date)
      await withFileLock(path, async () => {
        const existing = await readUtf8(path)
        const next = existing.length === 0 ? `${entry}\n` : `${existing.replace(/\s*$/u, '')}\n${entry}\n`
        await atomicWriteFile(path, next)
      })
      return { path, entry }
    })
  }

  async appendLongterm(text: string): Promise<void> {
    return this.runWithCapturedDir(async () => {
      const fact = text.replace(/\s+/gu, ' ').trim()
      if (fact.length === 0) {
        throw new Error('dsh-friend-memory: longterm fact is empty')
      }
      await withFileLock(this.memoryPath(), async () => {
        const parsed = parseMemoryMarkdown(await readUtf8(this.memoryPath()))
        const body = parsed.sections[LONGTERM_SECTION]
        const line = fact.startsWith('- ') ? fact : `- ${fact}`
        parsed.sections[LONGTERM_SECTION] = body.trim().length === 0 ? line : `${body.trimEnd()}\n${line}`
        const serialized = serializeMemoryMarkdown(parsed)
        const bytes = Buffer.byteLength(serialized, 'utf8')
        if (bytes > this.memoryMaxBytes) {
          throw new MemoryLimitError(bytes, this.memoryMaxBytes)
        }
        await atomicWriteFile(this.memoryPath(), serialized)
      })
    })
  }

  async listDailyDates(): Promise<string[]> {
    return this.runWithCapturedDir(async () => {
      const root = dailyDir(this.dataDir, this.slug)
      if (!await pathExists(root)) {
        return []
      }
      const names = await collectDailyDates(root)
      return [...names].sort()
    })
  }

  /**
   * Move daily notes older than the previous calendar month into
   * `memory/archive/YYYY-MM/`. Imported notes stay put.
   */
  async archiveOldNotes(reference = this.now()): Promise<string[]> {
    return this.runWithCapturedDir(async () => {
      const cutoff = firstDayOfPreviousMonth(reference)
      const root = dailyDir(this.dataDir, this.slug)
      if (!await pathExists(root)) {
        return []
      }
      const moved: string[] = []
      const entries = await readdir(root, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) {
          continue
        }
        const date = entry.name.slice(0, -3)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= cutoff) {
          continue
        }
        const from = join(root, entry.name)
        const destDir = archiveMonthDir(this.dataDir, this.slug, yearMonthOf(date))
        await mkdir(destDir, { recursive: true })
        const to = join(destDir, entry.name)
        await rename(from, to)
        moved.push(date)
      }
      return moved.sort()
    })
  }

  /**
   * Rolling backups `MEMORY.md.bak.N` with N ≤ 7. bak.1 is the newest.
   * Copies, never moves, the live file.
   */
  async rotateBackups(): Promise<string> {
    return this.runWithCapturedDir(async () => {
      const live = this.memoryPath()
      if (!await pathExists(live)) {
        await atomicWriteFile(live, serializeMemoryMarkdown(emptyMemory()))
      }
      const oldest = memoryBackupPath(this.dataDir, this.slug, MAX_MEMORY_BACKUPS)
      if (await pathExists(oldest)) {
        await rm(oldest, { force: true })
      }
      for (let index = MAX_MEMORY_BACKUPS - 1; index >= 1; index -= 1) {
        const from = memoryBackupPath(this.dataDir, this.slug, index)
        if (await pathExists(from)) {
          await rename(from, memoryBackupPath(this.dataDir, this.slug, index + 1))
        }
      }
      const newest = memoryBackupPath(this.dataDir, this.slug, 1)
      await copyFile(live, newest)
      return newest
    })
  }

  async restoreFromBackup(index = 1): Promise<void> {
    return this.runWithCapturedDir(async () => {
      const backup = memoryBackupPath(this.dataDir, this.slug, index)
      if (!await pathExists(backup)) {
        throw new Error(`dsh-friend-memory: backup ${backup} is missing`)
      }
      const contents = await readFile(backup, 'utf8')
      await lockedAtomicWrite(this.memoryPath(), contents)
    })
  }

  async listBackupIndexes(): Promise<number[]> {
    return this.runWithCapturedDir(async () => {
      const found: number[] = []
      for (let index = 1; index <= MAX_MEMORY_BACKUPS; index += 1) {
        if (await pathExists(memoryBackupPath(this.dataDir, this.slug, index))) {
          found.push(index)
        }
      }
      return found
    })
  }

  async recentDailyNotes(days: number, reference = this.now()): Promise<Array<{ date: string; text: string }>> {
    return this.runWithCapturedDir(async () => {
      const notes: Array<{ date: string; text: string }> = []
      for (let offset = 0; offset < days; offset += 1) {
        const date = formatDay(addDays(reference, -offset))
        const text = await this.readDailyAnywhere(date)
        if (text.length > 0) {
          notes.push({ date, text })
        }
      }
      return notes
    })
  }

  async readDailyAnywhere(date: string): Promise<string> {
    return this.runWithCapturedDir(async () => {
      const live = await readUtf8(this.dailyPath(date))
      if (live.length > 0) {
        return live
      }
      const archived = join(archiveMonthDir(this.dataDir, this.slug, yearMonthOf(date)), `${date}.md`)
      const archivedText = await readUtf8(archived)
      if (archivedText.length > 0) {
        return archivedText
      }
      return readUtf8(importedNotePath(this.dataDir, this.slug, date))
    })
  }
}

export function emptyMemory(): ParsedMemory {
  return {
    preamble: '',
    sections: {
      关于用户: '',
      重要事实: '',
      近期主题: '',
      待办与约定: '',
    },
    extras: [],
  }
}

export function parseMemoryMarkdown(raw: string): ParsedMemory {
  const parsed = emptyMemory()
  if (raw.trim().length === 0) {
    return parsed
  }

  const blocks = splitMarkdownSections(raw)
  const extras: Array<{ title: string; body: string }> = []
  let preamble = ''

  for (const block of blocks) {
    if (block.title === undefined) {
      preamble = block.body
      continue
    }
    if (isMemorySectionTitle(block.title)) {
      parsed.sections[block.title] = block.body
      continue
    }
    extras.push({ title: block.title, body: block.body })
  }

  parsed.preamble = preamble
  parsed.extras = extras
  return parsed
}

export function serializeMemoryMarkdown(parsed: ParsedMemory): string {
  const lines: string[] = []
  if (parsed.preamble.trim().length > 0) {
    lines.push(parsed.preamble.trimEnd(), '')
  }
  for (const title of MEMORY_SECTION_TITLES) {
    lines.push(`## ${title}`, '')
    const body = parsed.sections[title].trim()
    if (body.length > 0) {
      lines.push(body, '')
    }
  }
  for (const extra of parsed.extras) {
    lines.push(`## ${extra.title}`, '')
    const body = extra.body.trim()
    if (body.length > 0) {
      lines.push(body, '')
    }
  }
  return `${lines.join('\n').replace(/\s+$/u, '')}\n`
}

export function formatDailyEntry(time: string, source: string, text: string): string {
  return `- ${time} [${source}] ${text}`
}

export function parseDailyEntries(raw: string): DailyEntry[] {
  const entries: DailyEntry[] = []
  for (const line of raw.split(/\r?\n/u)) {
    const match = /^- (\d{2}:\d{2}) \[([^\]]+)\] (.+)$/u.exec(line)
    if (match === null) {
      continue
    }
    const time = match[1]
    const source = match[2]
    const text = match[3]
    if (time === undefined || source === undefined || text === undefined) {
      continue
    }
    entries.push({ time, source, text })
  }
  return entries
}

export function isMemorySectionTitle(title: string): title is MemorySectionTitle {
  return (MEMORY_SECTION_TITLES as readonly string[]).includes(title)
}

export function firstDayOfPreviousMonth(reference: Date): string {
  const cursor = new Date(reference.getFullYear(), reference.getMonth() - 1, 1)
  return formatDay(cursor)
}

function splitMarkdownSections(raw: string): Array<{ title?: string; body: string }> {
  const lines = raw.split(/\r?\n/u)
  const blocks: Array<{ title?: string; body: string[] }> = [{ body: [] }]
  for (const line of lines) {
    const heading = /^##[ \t]+(.+?)\s*$/u.exec(line)
    if (heading !== null && heading[1] !== undefined) {
      blocks.push({ title: heading[1], body: [] })
      continue
    }
    const current = blocks[blocks.length - 1]
    current?.body.push(line)
  }
  return blocks.map((block) => ({
    ...(block.title !== undefined ? { title: block.title } : {}),
    body: trimSectionBody(block.body.join('\n')),
  }))
}

function trimSectionBody(body: string): string {
  return body.replace(/^\n+/u, '').replace(/\s+$/u, '')
}

async function collectDailyDates(root: string): Promise<Set<string>> {
  const dates = new Set<string>()
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) {
      break
    }
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }
      const date = entry.name.slice(0, -3)
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        dates.add(date)
      }
    }
  }
  return dates
}

async function readUtf8(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isEnoent(error)) {
      return ''
    }
    throw error
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isEnoent(error)) {
      return false
    }
    throw error
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT'
}

function readLiveString(value: LiveString | undefined, fallback: string): string {
  if (value === undefined) {
    return fallback
  }
  return typeof value === 'function' ? value() : value
}

function readLiveNumber(value: LiveNumber | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  return typeof value === 'function' ? value() : value
}
