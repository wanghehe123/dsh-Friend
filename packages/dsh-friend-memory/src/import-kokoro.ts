import { createRequire } from 'node:module'
import { cp, mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { lockedAtomicWrite } from './atomic.ts'
import {
  characterDir,
  formatDay,
  importMarkPath,
  importedNotePath,
  memoryFilePath,
  storyFilePath,
  beliefsFilePath,
  userFilePath,
  DEFAULT_CHARACTER_SLUG,
  assertSafeSlug,
} from './paths.ts'
import {
  formatDailyEntry,
  parseMemoryMarkdown,
  serializeMemoryMarkdown,
} from './store.ts'

export type ImportSkip = { item: string; reason: string }

export type ImportReport = {
  memories: number
  highlights: number
  characters: number
  growthEpisodes: number
  growthBeliefs: number
  userProfile: boolean
  live2dCopied: number
  petConfigMapped: boolean
  skipped: ImportSkip[]
  sourceMtimeMs: number
}

export type KokoroMemoryRow = {
  id: number
  content: string
  created_at: number
  importance: number
  character_id: string
  status?: string
}

export type KokoroCharacterRow = {
  id: string
  name: string
  persona: string
  user_nickname: string
}

export type KokoroGrowthBeat = {
  character_id: string
  kind: string
  title: string
  narrative: string
  age: number | null
  status: string
  sort_order: number
}

export type KokoroSnapshot = {
  memories: readonly KokoroMemoryRow[]
  characters: readonly KokoroCharacterRow[]
  growthBeats: readonly KokoroGrowthBeat[]
  userProfile?: { user_name?: string; user_persona?: string }
  responseStyle?: Record<string, unknown>
  petConfig?: Record<string, unknown>
  live2dModelDirs?: readonly string[]
}

export type SqliteLike = {
  prepare(sql: string): { all: (...params: unknown[]) => unknown[] }
  close?: () => void
}

export type OpenSqlite = (path: string) => SqliteLike

const IMPORT_MARK_VERSION = 1

export async function importKokoro(options: {
  fromDir: string
  dataDir: string
  openSqlite?: OpenSqlite
  now?: () => Date
}): Promise<ImportReport> {
  const dbPath = join(options.fromDir, 'kokoro.db')
  const sourceMtimeMs = (await stat(dbPath)).mtimeMs
  const mark = await readImportMark(options.dataDir)
  const skipped: ImportSkip[] = []
  const importedIds = new Set(mark?.memoryIds ?? [])

  const snapshot = options.openSqlite === undefined
    ? await readKokoroSnapshot(dbPath, openNodeSqlite)
    : await readKokoroSnapshot(dbPath, options.openSqlite)
  const userProfileFile = snapshot.userProfile ?? await readJsonFile(join(options.fromDir, 'user_profile.json'))
  const responseStyleFile = snapshot.responseStyle ?? await readJsonFile(join(options.fromDir, 'response_style.json'))
  const petConfigFile = snapshot.petConfig ?? await readJsonFile(join(options.fromDir, 'pet_config.json'))
  if (userProfileFile !== undefined) {
    snapshot.userProfile = userProfileFile as NonNullable<KokoroSnapshot['userProfile']>
  }
  if (responseStyleFile !== undefined) {
    snapshot.responseStyle = responseStyleFile
  }
  if (petConfigFile !== undefined) {
    snapshot.petConfig = petConfigFile
  }

  const afterMtime = (await stat(dbPath)).mtimeMs
  if (afterMtime !== sourceMtimeMs) {
    throw new Error('dsh-friend-memory: kokoro.db mtime changed during import; refusing to continue')
  }

  let memories = 0
  let highlights = 0
  const highlightLines = new Map<string, string[]>()
  const dailyBuckets = new Map<string, Map<string, string[]>>()

  for (const row of snapshot.memories) {
    if (row.status === 'invalidated' || row.status === 'archived') {
      skipped.push({ item: `memory:${row.id}`, reason: `status=${row.status}` })
      continue
    }
    if (importedIds.has(row.id)) {
      skipped.push({ item: `memory:${row.id}`, reason: 'already-imported' })
      continue
    }
    const slug = sanitizeSlug(row.character_id)
    const date = formatDay(new Date(row.created_at * (row.created_at < 1e12 ? 1000 : 1)))
    const line = formatDailyEntry('00:00', 'import', row.content.trim())
    const byDate = dailyBuckets.get(slug) ?? new Map<string, string[]>()
    const lines = byDate.get(date) ?? []
    lines.push(line)
    byDate.set(date, lines)
    dailyBuckets.set(slug, byDate)
    importedIds.add(row.id)
    memories += 1
    if (row.importance >= 0.9) {
      const list = highlightLines.get(slug) ?? []
      list.push(`- ${row.content.trim()}`)
      highlightLines.set(slug, list)
      highlights += 1
    }
  }

  for (const [slug, byDate] of dailyBuckets) {
    for (const [date, lines] of byDate) {
      const path = importedNotePath(options.dataDir, slug, date)
      const existing = await readOptional(path)
      const next = existing.length === 0 ? `${lines.join('\n')}\n` : `${existing.replace(/\s*$/u, '')}\n${lines.join('\n')}\n`
      await lockedAtomicWrite(path, next)
    }
  }

  for (const [slug, lines] of highlightLines) {
    const path = memoryFilePath(options.dataDir, slug)
    const parsed = parseMemoryMarkdown(await readOptional(path))
    const extras = [...parsed.extras]
    const existing = extras.find((extra) => extra.title === '导入精选')
    if (existing === undefined) {
      extras.push({ title: '导入精选', body: lines.join('\n') })
    } else {
      existing.body = existing.body.trim().length === 0
        ? lines.join('\n')
        : `${existing.body.trimEnd()}\n${lines.join('\n')}`
    }
    const next = { ...parsed, extras }
    await lockedAtomicWrite(path, serializeMemoryMarkdown(next))
  }

  let characters = 0
  for (const row of snapshot.characters) {
    const slug = sanitizeSlug(row.id)
    const personaPath = join(characterDir(options.dataDir, slug), 'persona.json')
    if (await fileExists(personaPath)) {
      skipped.push({ item: `character:${row.id}`, reason: 'persona.json-exists' })
      continue
    }
    const persona = {
      name: row.name || slug,
      personality: row.persona || '（从 Kokoro 导入，待补全）',
      background: '',
      speakingStyle: '',
      language: 'zh-CN',
      nickname: row.user_nickname || '你',
      greetings: [],
      tags: ['imported'],
    }
    await lockedAtomicWrite(personaPath, `${JSON.stringify(persona, null, 2)}\n`)
    characters += 1
  }

  let growthEpisodes = 0
  let growthBeliefs = 0
  const storyBySlug = new Map<string, string[]>()
  const beliefsBySlug = new Map<string, string[]>()
  for (const beat of snapshot.growthBeats) {
    if (beat.status === 'draft' || beat.status === 'drafting') {
      skipped.push({ item: `growth:${beat.title}`, reason: 'draft' })
      continue
    }
    const slug = sanitizeSlug(beat.character_id)
    if (beat.kind === 'reflection') {
      const list = beliefsBySlug.get(slug) ?? []
      list.push(`- ${beat.narrative.trim()}`)
      beliefsBySlug.set(slug, list)
      growthBeliefs += 1
      continue
    }
    const agePrefix = beat.age === null ? '' : `${toFullWidthAge(beat.age)}岁 · `
    const list = storyBySlug.get(slug) ?? []
    list.push(`## ${agePrefix}${beat.title || '节拍'}\n\n${beat.narrative.trim()}`)
    storyBySlug.set(slug, list)
    growthEpisodes += 1
  }
  for (const [slug, parts] of storyBySlug) {
    const path = storyFilePath(options.dataDir, slug)
    if (await fileExists(path)) {
      skipped.push({ item: `story:${slug}`, reason: 'story.md-exists' })
      continue
    }
    await lockedAtomicWrite(path, `${parts.join('\n\n')}\n`)
  }
  for (const [slug, parts] of beliefsBySlug) {
    const path = beliefsFilePath(options.dataDir, slug)
    if (await fileExists(path)) {
      skipped.push({ item: `beliefs:${slug}`, reason: 'beliefs.md-exists' })
      continue
    }
    await lockedAtomicWrite(path, `${parts.join('\n')}\n`)
  }

  let userProfile = false
  if (snapshot.userProfile !== undefined) {
    const path = userFilePath(options.dataDir)
    if (await fileExists(path)) {
      skipped.push({ item: 'USER.md', reason: 'exists' })
    } else {
      const name = snapshot.userProfile.user_name ?? ''
      const persona = snapshot.userProfile.user_persona ?? ''
      const style = snapshot.responseStyle === undefined
        ? ''
        : `\n\n## 回复风格\n\n${JSON.stringify(snapshot.responseStyle, null, 2)}`
      await lockedAtomicWrite(path, `# 用户\n\n- 名字：${name}\n\n${persona}${style}\n`)
      userProfile = true
    }
  }

  let live2dCopied = 0
  const modelsDir = join(options.fromDir, 'live2d_models')
  if (await dirExists(modelsDir)) {
    const dest = join(options.dataDir, 'models')
    await mkdir(dest, { recursive: true })
    await cp(modelsDir, dest, { recursive: true, force: false })
    live2dCopied = 1
  }

  let petConfigMapped = false
  if (snapshot.petConfig !== undefined) {
    const mapped = mapPetConfig(snapshot.petConfig)
    await lockedAtomicWrite(
      join(options.dataDir, 'imported-pet-config.json'),
      `${JSON.stringify(mapped, null, 2)}\n`,
    )
    petConfigMapped = true
  }

  await lockedAtomicWrite(
    importMarkPath(options.dataDir),
    `${JSON.stringify({ version: IMPORT_MARK_VERSION, memoryIds: [...importedIds] }, null, 2)}\n`,
  )

  const finalMtime = (await stat(dbPath)).mtimeMs
  if (finalMtime !== sourceMtimeMs) {
    throw new Error('dsh-friend-memory: kokoro.db mtime changed; import was not read-only')
  }

  return {
    memories,
    highlights,
    characters,
    growthEpisodes,
    growthBeliefs,
    userProfile,
    live2dCopied,
    petConfigMapped,
    skipped,
    sourceMtimeMs,
  }
}

export async function readKokoroSnapshot(dbPath: string, openSqlite: OpenSqlite): Promise<KokoroSnapshot> {
  const db = openSqlite(dbPath)
  try {
    const memories = asRows<KokoroMemoryRow>(
      safeAll(db, 'SELECT id, content, created_at, importance, character_id, status FROM memories'),
      (row) => ({
        id: Number(row.id),
        content: String(row.content ?? ''),
        created_at: Number(row.created_at ?? 0),
        importance: Number(row.importance ?? 0.5),
        character_id: String(row.character_id ?? DEFAULT_CHARACTER_SLUG),
        ...(typeof row.status === 'string' ? { status: row.status } : {}),
      }),
    )
    const characters = asRows<KokoroCharacterRow>(
      safeAll(db, 'SELECT id, name, persona, user_nickname FROM characters'),
      (row) => ({
        id: String(row.id ?? DEFAULT_CHARACTER_SLUG),
        name: String(row.name ?? ''),
        persona: String(row.persona ?? ''),
        user_nickname: String(row.user_nickname ?? '你'),
      }),
    )
    const growthBeats = asRows<KokoroGrowthBeat>(
      safeAll(db, 'SELECT character_id, kind, title, narrative, age, status, sort_order FROM growth_beats'),
      (row) => ({
        character_id: String(row.character_id ?? DEFAULT_CHARACTER_SLUG),
        kind: String(row.kind ?? 'episode'),
        title: String(row.title ?? ''),
        narrative: String(row.narrative ?? ''),
        age: row.age === null || row.age === undefined ? null : Number(row.age),
        status: String(row.status ?? 'draft'),
        sort_order: Number(row.sort_order ?? 0),
      }),
    )
    return { memories, characters, growthBeats }
  } finally {
    db.close?.()
  }
}

export function openNodeSqlite(path: string): SqliteLike {
  const { DatabaseSync } = requireNodeSqlite()
  return new DatabaseSync(path, { readOnly: true }) as SqliteLike
}

export function mapPetConfig(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    namespace: 'friend-pet',
    enabled: raw.enabled,
    positionX: raw.position_x,
    positionY: raw.position_y,
    shortcut: raw.shortcut,
    windowWidth: raw.window_width,
    windowHeight: raw.window_height,
    modelScale: raw.model_scale,
    targetFps: raw.render_fps,
  }
}

function requireNodeSqlite(): { DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteLike } {
  return createRequire(import.meta.url)('node:sqlite') as {
    DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteLike
  }
}

function safeAll(db: SqliteLike, sql: string): unknown[] {
  try {
    return db.prepare(sql).all()
  } catch {
    return []
  }
}

function asRows<T>(rows: unknown[], map: (row: Record<string, unknown>) => T): T[] {
  const out: T[] = []
  for (const row of rows) {
    if (row !== null && typeof row === 'object') {
      out.push(map(row as Record<string, unknown>))
    }
  }
  return out
}

function sanitizeSlug(raw: string): string {
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '')
  const next = slug.length > 0 ? slug : DEFAULT_CHARACTER_SLUG
  assertSafeSlug(next)
  return next
}

function toFullWidthAge(age: number): string {
  return String(age).replace(/\d/gu, (digit) => '０１２３４５６７８９'[Number(digit)] ?? digit)
}

async function readImportMark(dataDir: string): Promise<{ memoryIds: number[] } | undefined> {
  try {
    const raw = await readFile(importMarkPath(dataDir), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined
    }
    const ids = (parsed as { memoryIds?: unknown }).memoryIds
    if (!Array.isArray(ids)) {
      return undefined
    }
    return { memoryIds: ids.filter((id): id is number => typeof id === 'number') }
  } catch {
    return undefined
  }
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return undefined
  } catch {
    return undefined
  }
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

