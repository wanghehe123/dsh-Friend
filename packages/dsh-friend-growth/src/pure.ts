/**
 * Pure growth functions ported from Kokoro `ai/growth.rs`.
 *
 * Parse / sort / time / compose stay side-effect free. LLM I/O and disk
 * live in the pipeline / store shell.
 */

export const DEFAULT_LANGUAGE = '中文'
export const EXPAND_BATCH_SIZE = 4
export const DEFAULT_EPISODE_IMPORTANCE = 0.7
export const DEFAULT_REFLECTION_IMPORTANCE = 0.92
export const MIN_REFLECTION_IMPORTANCE = 0.9

export type OutlineEvent = {
  age: number
  title: string
  summary: string
  nodeId?: number
}

export type ParsedBeat = {
  nodeId?: number
  age?: number
  kind: string
  title: string
  narrative: string
  traitEffect: string
  importance: number
}

export type ReflectionResult = {
  reflections: ParsedBeat[]
  lifeStorySummary: string
}

/** Draft / committed beat used by compose + chronological sort. */
export type GrowthBeat = {
  id: string
  characterId: string
  nodeId?: number
  batchId: string
  age?: number
  occurredAt?: number
  kind: string
  title: string
  narrative: string
  traitEffect: string
  importance: number
  status: string
  sortOrder: number
}

export type GrowthProfileStatus = 'empty' | 'drafting' | 'committed'

export type GrowthProfile = {
  characterId: string
  birthYear?: number
  currentAge?: number
  baseAttributes: string
  worldSetting: string
  lifeStorySummary: string
  status: GrowthProfileStatus
  language: string
}

export type GrowthNode = {
  id: number
  ageFrom?: number
  ageTo?: number
  stageLabel: string
  title: string
  note: string
}

/**
 * Memory body written later into story.md / beliefs.md.
 *
 * Episodes carry a fullwidth age prefix so prompt injection does not need
 * to convert `occurredAt`. Reflections are already abstract and stay bare.
 */
export function composeMemoryContent(beat: Pick<GrowthBeat, 'kind' | 'age' | 'narrative'>): string {
  if (beat.kind.trim() === 'reflection') {
    return beat.narrative
  }
  if (beat.age !== undefined) {
    return `（${beat.age}岁）${beat.narrative}`
  }
  return beat.narrative
}

/**
 * Midnight UTC on 1 January of `birthYear + age`, as unix seconds.
 * Returns `undefined` when either input is missing or the calendar date
 * cannot be represented. Never throws.
 */
export function occurredAtUnix(
  birthYear: number | undefined,
  age: number | undefined,
): number | undefined {
  if (birthYear === undefined || age === undefined) {
    return undefined
  }
  if (!Number.isSafeInteger(birthYear) || !Number.isSafeInteger(age)) {
    return undefined
  }
  const year = birthYear + age
  if (!Number.isSafeInteger(year)) {
    return undefined
  }
  if (year > 2147483647 || year < -2147483648) {
    return undefined
  }
  const date = new Date(0)
  date.setUTCFullYear(year, 0, 1)
  date.setUTCHours(0, 0, 0, 0)
  if (date.getUTCFullYear() !== year) {
    return undefined
  }
  const ms = date.getTime()
  if (!Number.isFinite(ms)) {
    return undefined
  }
  return Math.floor(ms / 1000)
}

/** Sort by age ascending (missing age last) and number `sortOrder` from 0. */
export function assignSortOrder(beats: GrowthBeat[]): void {
  beats.sort((left, right) => {
    if (left.age !== undefined && right.age !== undefined) {
      return left.age - right.age
    }
    if (left.age !== undefined) {
      return -1
    }
    if (right.age !== undefined) {
      return 1
    }
    return 0
  })
  for (const [index, beat] of beats.entries()) {
    beat.sortOrder = index
  }
}

export function parseOutlineResponse(raw: string): OutlineEvent[] {
  let value: unknown
  try {
    value = parseJsonValue(raw)
  } catch (error) {
    throw new Error(`failed to parse growth outline JSON: ${cause(error)}`)
  }
  const items = arrayFromValue(value, ['events', 'outline', 'items', 'skeleton', 'timeline'])
  if (items === undefined) {
    throw new Error(
      `growth outline JSON must be an array or an object with an "events" array; preview: ${previewText(raw)}`,
    )
  }
  const events: OutlineEvent[] = []
  for (const item of items) {
    const event = outlineEventFromValue(item)
    if (event !== undefined) {
      events.push(event)
    }
  }
  return events
}

export function parseExpandResponse(raw: string): ParsedBeat[] {
  let value: unknown
  try {
    value = parseJsonValue(raw)
  } catch (error) {
    throw new Error(`failed to parse growth expand JSON: ${cause(error)}`)
  }
  const items = arrayFromValue(value, ['beats', 'events', 'episodes', 'items'])
  if (items === undefined) {
    throw new Error(
      `growth expand JSON must be an array or an object with a "beats" array; preview: ${previewText(raw)}`,
    )
  }
  const beats: ParsedBeat[] = []
  for (const item of items) {
    const beat = expandedBeatFromValue(item, 'episode')
    if (beat !== undefined) {
      beats.push(beat)
    }
  }
  return beats
}

export function parseReflectResponse(raw: string): ReflectionResult {
  let value: unknown
  try {
    value = parseJsonValue(raw)
  } catch (error) {
    throw new Error(`failed to parse growth reflect JSON: ${cause(error)}`)
  }
  if (!isPlainObject(value)) {
    throw new Error(
      `growth reflect JSON must be an object with "reflections" and "life_story_summary"; preview: ${previewText(raw)}`,
    )
  }
  const items = value.reflections ?? value.core_beliefs ?? value.beliefs ?? value.items
  const reflections: ParsedBeat[] = []
  const wrapped = arrayOrWrapped(items)
  if (wrapped !== undefined) {
    for (const item of wrapped) {
      const beat = expandedBeatFromValue(item, 'reflection')
      if (beat === undefined) {
        continue
      }
      beat.kind = 'reflection'
      delete beat.age
      beat.importance = Math.max(beat.importance, MIN_REFLECTION_IMPORTANCE)
      reflections.push(beat)
    }
  }
  const summaryRaw = value.life_story_summary ?? value.summary ?? value.resume
  const lifeStorySummary = jsonString(summaryRaw).trim()
  if (reflections.length === 0 && lifeStorySummary.length === 0) {
    throw new Error(
      `growth reflect JSON had no usable reflections or life_story_summary; preview: ${previewText(raw)}`,
    )
  }
  return { reflections, lifeStorySummary }
}

export function normalizeOutline(events: OutlineEvent[], currentAge?: number): OutlineEvent[] {
  const kept = events.filter((event) => event.age >= 0)
  const aged = currentAge === undefined ? kept : kept.filter((event) => event.age <= currentAge)
  return [...aged].sort((left, right) => left.age - right.age)
}

/**
 * Prefer batches of 3–4. A remainder of 5 is split 3+2 so the last batch
 * is never a singleton after a full four.
 */
export function batchRanges(len: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let index = 0
  while (index < len) {
    const remaining = len - index
    const take = remaining <= EXPAND_BATCH_SIZE
      ? remaining
      : remaining === 5
        ? 3
        : EXPAND_BATCH_SIZE
    ranges.push([index, index + take])
    index += take
  }
  return ranges
}

export function fillBeatsFromOutline(beats: ParsedBeat[], outline: readonly OutlineEvent[]): void {
  for (const [index, beat] of beats.entries()) {
    const source = outline[index]
    if (source === undefined) {
      continue
    }
    if (beat.age === undefined) {
      beat.age = source.age
    }
    if (beat.nodeId === undefined && source.nodeId !== undefined) {
      beat.nodeId = source.nodeId
    }
    if (beat.title.trim().length === 0) {
      beat.title = source.title
    }
  }
}

export function resolveLanguage(targetLanguage: string | undefined): string {
  const trimmed = targetLanguage?.trim()
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : DEFAULT_LANGUAGE
}

export function toGrowthBeat(input: {
  characterId: string
  batchId: string
  birthYear?: number
  draft: ParsedBeat
  id: string
}): GrowthBeat {
  const occurredAt = input.draft.kind === 'reflection'
    ? undefined
    : occurredAtUnix(input.birthYear, input.draft.age)
  const beat: GrowthBeat = {
    id: input.id,
    characterId: input.characterId,
    batchId: input.batchId,
    kind: input.draft.kind,
    title: input.draft.title,
    narrative: input.draft.narrative,
    traitEffect: input.draft.traitEffect,
    importance: input.draft.importance,
    status: 'draft',
    sortOrder: 0,
  }
  if (input.draft.nodeId !== undefined) {
    beat.nodeId = input.draft.nodeId
  }
  if (input.draft.age !== undefined) {
    beat.age = input.draft.age
  }
  if (occurredAt !== undefined) {
    beat.occurredAt = occurredAt
  }
  return beat
}

function parseJsonValue(raw: string): unknown {
  const trimmed = raw.trim().replace(/^\uFEFF/u, '')
  const candidate = extractJsonCandidate(trimmed)
  try {
    const value = JSON.parse(candidate) as unknown
    if (jsonLooksStructured(value)) {
      return value
    }
  } catch {
    // fall through to balanced-slice search
  }

  const bytes = candidate
  for (let start = 0; start < bytes.length; start += 1) {
    const ch = bytes[start]
    if (ch !== '{' && ch !== '[') {
      continue
    }
    const slice = balancedJsonSlice(candidate, start)
    if (slice === undefined) {
      continue
    }
    try {
      const value = JSON.parse(slice) as unknown
      if (jsonLooksStructured(value)) {
        return value
      }
    } catch {
      // keep scanning
    }
  }

  try {
    return JSON.parse(candidate) as unknown
  } catch (error) {
    throw new Error(`${cause(error)}; preview: ${previewText(raw)}`)
  }
}

function jsonLooksStructured(value: unknown): boolean {
  if (Array.isArray(value)) {
    return true
  }
  return isPlainObject(value) && Object.keys(value).length > 0
}

function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim()
  const open = trimmed.indexOf('```')
  if (open < 0) {
    return trimmed
  }
  const afterTicks = trimmed.slice(open + 3)
  const afterLang = afterTicks.slice(0, 4).toLowerCase() === 'json'
    ? afterTicks.slice(4)
    : afterTicks
  const stripped = afterLang.replace(/^[\r\n \t]+/u, '')
  const close = stripped.indexOf('```')
  if (close >= 0) {
    const inner = stripped.slice(0, close).trim()
    if (inner.length > 0) {
      return inner
    }
  }
  return stripped.trim()
}

function balancedJsonSlice(source: string, start: number): string | undefined {
  if (start >= source.length) {
    return undefined
  }
  const open = source[start]
  const close = open === '{' ? '}' : open === '[' ? ']' : undefined
  if (close === undefined || open === undefined) {
    return undefined
  }
  let depth = 0
  let inString = false
  let escape = false
  for (let offset = 0; offset < source.length - start; offset += 1) {
    const byte = source[start + offset]
    if (byte === undefined) {
      break
    }
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (byte === '\\') {
        escape = true
        continue
      }
      if (byte === '"') {
        inString = false
      }
      continue
    }
    if (byte === '"') {
      inString = true
      continue
    }
    if (byte === open) {
      depth += 1
      continue
    }
    if (byte === close) {
      depth -= 1
      if (depth === 0) {
        return source.slice(start, start + offset + 1)
      }
    }
  }
  return undefined
}

function arrayFromValue(value: unknown, keys: readonly string[]): unknown[] | undefined {
  if (Array.isArray(value)) {
    return value
  }
  if (!isPlainObject(value)) {
    return undefined
  }
  for (const key of keys) {
    const nested = value[key]
    if (Array.isArray(nested)) {
      return nested
    }
    if (isPlainObject(nested)) {
      return [nested]
    }
  }
  if (
    Object.hasOwn(value, 'age')
    || Object.hasOwn(value, 'narrative')
    || Object.hasOwn(value, 'title')
    || Object.hasOwn(value, 'summary')
  ) {
    return [value]
  }
  return undefined
}

function arrayOrWrapped(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) {
    return value
  }
  if (isPlainObject(value)) {
    return [value]
  }
  return undefined
}

function outlineEventFromValue(value: unknown): OutlineEvent | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const age = jsonOptI64(value.age)
  if (age === undefined || age < 0) {
    return undefined
  }
  const titleRaw = jsonString(value.title)
  const summaryRaw = jsonString(value.summary ?? value.synopsis ?? value.one_liner)
  const title = fallbackTitle(titleRaw, summaryRaw)
  const summary = summaryRaw.trim().length === 0 ? title : summaryRaw.trim()
  if (title.length === 0 && summary.length === 0) {
    return undefined
  }
  const event: OutlineEvent = { age, title, summary }
  const nodeId = jsonOptI64(value.node_id)
  if (nodeId !== undefined) {
    event.nodeId = nodeId
  }
  return event
}

function expandedBeatFromValue(value: unknown, kind: string): ParsedBeat | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const narrative = jsonString(value.narrative ?? value.content ?? value.text).trim()
  if (narrative.length === 0) {
    return undefined
  }
  const titleRaw = jsonString(value.title)
  const importanceRaw = jsonF64(value.importance)
  const defaultImportance = kind === 'reflection'
    ? DEFAULT_REFLECTION_IMPORTANCE
    : DEFAULT_EPISODE_IMPORTANCE
  const beat: ParsedBeat = {
    kind,
    title: fallbackTitle(titleRaw, narrative),
    narrative,
    traitEffect: jsonString(value.trait_effect ?? value.traitEffect).trim(),
    importance: normalizeImportance(importanceRaw, defaultImportance),
  }
  const nodeId = jsonOptI64(value.node_id)
  if (nodeId !== undefined) {
    beat.nodeId = nodeId
  }
  const age = jsonOptI64(value.age)
  if (age !== undefined) {
    beat.age = age
  }
  return beat
}

function fallbackTitle(title: string, backup: string): string {
  const trimmed = title.trim()
  if (trimmed.length > 0) {
    return trimmed
  }
  const fallback = backup.trim()
  if (fallback.length === 0) {
    return ''
  }
  return Array.from(fallback).slice(0, 20).join('')
}

function normalizeImportance(raw: number | undefined, fallback: number): number {
  const value = raw !== undefined && Number.isFinite(raw) ? raw : fallback
  return Math.min(1, Math.max(0, value))
}

function jsonOptI64(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.length === 0 || text.toLowerCase() === 'null' || text.toLowerCase() === 'none') {
      return undefined
    }
    return parseI64Loose(text)
  }
  return parseI64Value(value)
}

function parseI64Value(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  if (typeof value === 'string') {
    return parseI64Loose(value)
  }
  return undefined
}

function parseI64Loose(text: string): number | undefined {
  const trimmed = text.trim()
  const asInt = Number.parseInt(trimmed, 10)
  if (trimmed === String(asInt) || /^-?\d+$/u.test(trimmed)) {
    return asInt
  }
  const asFloat = Number.parseFloat(trimmed)
  if (Number.isFinite(asFloat) && trimmed === String(asFloat)) {
    return Math.trunc(asFloat)
  }
  let start = 0
  while (start < trimmed.length) {
    const ch = trimmed[start]
    if (ch !== undefined && (isAsciiDigit(ch) || ch === '-')) {
      break
    }
    start += 1
  }
  let end = start
  while (end < trimmed.length) {
    const ch = trimmed[end]
    if (ch === undefined || (!isAsciiDigit(ch) && ch !== '-')) {
      break
    }
    end += 1
  }
  const digits = trimmed.slice(start, end)
  if (digits.length === 0) {
    return undefined
  }
  const parsed = Number.parseInt(digits, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isAsciiDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function jsonF64(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim())
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function jsonString(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

function previewText(raw: string): string {
  const slice = Array.from(raw).slice(0, 240).join('')
  const collapsed = slice.split(/\s+/u).join(' ')
  const preview = Array.from(collapsed).slice(0, 180).join('')
  return Array.from(raw).length > 180 ? `${preview}…` : preview
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cause(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
