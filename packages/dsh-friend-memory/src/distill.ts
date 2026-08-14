import { runPrompt, type MemoryLlm } from './llm.ts'
import {
  buildDistillSystemPrompt,
  buildDistillUserPrompt,
  stripFence,
} from './prompts.ts'
import type { MemorySettings } from './settings.ts'
import {
  isMemorySectionTitle,
  MEMORY_SECTION_TITLES,
  parseMemoryMarkdown,
  serializeMemoryMarkdown,
  type MemoryStore,
  type ParsedMemory,
} from './store.ts'

export type DistillStatus = 'ok' | 'rolled-back' | 'skipped'

export type DistillResult = {
  status: DistillStatus
  reason: string
  backup?: string
  bytes?: number
}

export type DistillListener = (event: {
  type: 'distill-start' | 'distill-ok' | 'distill-error'
  payload: unknown
}) => void

export type DistillOptions = {
  store: MemoryStore
  llm: MemoryLlm
  settings: () => MemorySettings
  now?: () => Date
  lookbackDays?: number
}

export async function distillMemory(options: DistillOptions): Promise<DistillResult> {
  return options.store.runWithCapturedDir(() => distillCaptured(options))
}

async function distillCaptured(options: DistillOptions): Promise<DistillResult> {
  const settings = options.settings()
  if (!settings.enabled) {
    return { status: 'skipped', reason: 'disabled' }
  }

  const store = options.store
  const before = await store.readMemoryRaw()
  const backup = await store.rotateBackups()
  const notes = await store.recentDailyNotes(options.lookbackDays ?? 7, options.now?.() ?? new Date())

  let raw: string
  try {
    raw = await runPrompt(options.llm, {
      system: buildDistillSystemPrompt(store.memoryMaxBytes),
      user: buildDistillUserPrompt({
        memory: before.length > 0 ? before : serializeMemoryMarkdown(parseMemoryMarkdown('')),
        notes,
      }),
    })
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error)
    await store.restoreFromBackup(1)
    return { status: 'rolled-back', reason: `llm-error: ${cause}`, backup }
  }

  const parsed = parseDistillOutput(raw)
  if (parsed === undefined) {
    await store.restoreFromBackup(1)
    return { status: 'rolled-back', reason: 'corrupt-output', backup }
  }

  const previous = parseMemoryMarkdown(before)
  const merged = applyDistillGuards(previous, parsed, store.memoryMaxBytes)
  if (merged.status === 'reject') {
    await store.restoreFromBackup(1)
    return { status: 'rolled-back', reason: merged.reason, backup }
  }

  try {
    await store.writeMemory(merged.document)
  } catch (error) {
    await store.restoreFromBackup(1)
    const cause = error instanceof Error ? error.message : String(error)
    return { status: 'rolled-back', reason: `write-error: ${cause}`, backup }
  }

  const bytes = await store.measureMemoryBytes()
  return { status: 'ok', reason: 'ok', backup, bytes }
}

export function parseDistillOutput(raw: string): ParsedMemory | undefined {
  const text = stripFence(raw).trim()
  if (text.length === 0) {
    return undefined
  }
  const parsed = parseMemoryMarkdown(text)
  const missing = MEMORY_SECTION_TITLES.filter((title) => {
    const headingPresent = new RegExp(`^##[ \\t]+${escapeRegExp(title)}\\s*$`, 'mu').test(text)
    return !headingPresent && parsed.sections[title].trim().length === 0
  })
  const hasAnyHeading = MEMORY_SECTION_TITLES.some((title) =>
    new RegExp(`^##[ \\t]+${escapeRegExp(title)}\\s*$`, 'mu').test(text),
  )
  if (!hasAnyHeading || missing.length === MEMORY_SECTION_TITLES.length) {
    return undefined
  }
  if (!MEMORY_SECTION_TITLES.every((title) => isMemorySectionTitle(title))) {
    return undefined
  }
  return parsed
}

export type GuardDecision =
  | { status: 'ok'; document: ParsedMemory }
  | { status: 'reject'; reason: string }

/**
 * Keep user extras / preamble. Re-insert any 「重要」facts the model dropped.
 * Compress non-critical lines if still over the byte limit.
 */
export function applyDistillGuards(
  previous: ParsedMemory,
  next: ParsedMemory,
  maxBytes: number,
): GuardDecision {
  const document: ParsedMemory = {
    preamble: previous.preamble,
    sections: { ...next.sections },
    extras: previous.extras,
  }

  const important = collectImportantFacts(previous)
  const dropped = important.filter((fact) => !containsFact(document, fact))
  if (dropped.length > 0) {
    const extra = dropped.map((fact) => (fact.startsWith('- ') ? fact : `- ${fact}`)).join('\n')
    const current = document.sections['重要事实'].trim()
    document.sections['重要事实'] = current.length === 0 ? extra : `${current}\n${extra}`
  }

  let serialized = serializeMemoryMarkdown(document)
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) {
    return { status: 'ok', document }
  }

  const compressed = compressToLimit(document, important, maxBytes)
  serialized = serializeMemoryMarkdown(compressed)
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    return { status: 'reject', reason: 'over-limit' }
  }
  if (important.some((fact) => !containsFact(compressed, fact))) {
    return { status: 'reject', reason: 'lost-important' }
  }
  return { status: 'ok', document: compressed }
}

export function collectImportantFacts(parsed: ParsedMemory): string[] {
  const facts: string[] = []
  for (const title of MEMORY_SECTION_TITLES) {
    for (const line of parsed.sections[title].split(/\r?\n/u)) {
      const trimmed = line.trim()
      if (trimmed.length === 0) {
        continue
      }
      if (trimmed.includes('重要')) {
        facts.push(trimmed)
      }
    }
  }
  return facts
}

export function containsFact(parsed: ParsedMemory, fact: string): boolean {
  const needle = normalizeFact(fact)
  if (needle.length === 0) {
    return true
  }
  const haystack = serializeMemoryMarkdown(parsed)
  if (haystack.includes(fact) || haystack.includes(needle)) {
    return true
  }
  const tokens = needle.split(/\s+/u).filter((token) => token.length >= 2)
  if (tokens.length === 0) {
    return haystack.includes(needle)
  }
  return tokens.every((token) => haystack.includes(token))
}

export function nextDistillAt(from: Date, hour: number, minute: number): Date {
  const next = new Date(from.getTime())
  next.setSeconds(0, 0)
  next.setHours(hour, minute, 0, 0)
  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  return next
}

/**
 * How often the distill clock re-reads hour/minute and re-arms if they changed.
 * Host consumers have no `ctx.settings.subscribe`; `get()` is live, so this
 * poll (plus a re-check at fire) is what makes a config-center clock edit
 * take effect without restarting dsh.
 */
export const DISTILL_CLOCK_WATCH_MS = 10_000

export function scheduleDistill(options: {
  hour: number | (() => number)
  minute: number | (() => number)
  run: () => void | Promise<void>
  now?: () => Date
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
  /** Override {@link DISTILL_CLOCK_WATCH_MS}. `0` disables the watch (tests). */
  watchIntervalMs?: number
}): () => void {
  const now = options.now ?? (() => new Date())
  const setTimer = options.setTimeoutFn ?? setTimeout
  const clearTimer = options.clearTimeoutFn ?? clearTimeout
  const readHour = asClockReader(options.hour)
  const readMinute = asClockReader(options.minute)
  const watchIntervalMs = options.watchIntervalMs ?? DISTILL_CLOCK_WATCH_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  let watchTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let armedHour = readHour()
  let armedMinute = readMinute()

  const clearDistill = (): void => {
    if (timer !== undefined) {
      clearTimer(timer)
      timer = undefined
    }
  }

  const arm = (): void => {
    if (disposed) {
      return
    }
    clearDistill()
    armedHour = readHour()
    armedMinute = readMinute()
    const delay = Math.max(0, nextDistillAt(now(), armedHour, armedMinute).getTime() - now().getTime())
    timer = setTimer(() => {
      if (disposed) {
        return
      }
      const hour = readHour()
      const minute = readMinute()
      if (hour !== armedHour || minute !== armedMinute) {
        arm()
        return
      }
      void Promise.resolve(options.run()).finally(() => {
        if (!disposed) {
          arm()
        }
      })
    }, delay)
    timer.unref?.()
  }

  const pollClock = (): void => {
    if (disposed || watchIntervalMs <= 0) {
      return
    }
    const hour = readHour()
    const minute = readMinute()
    if (hour !== armedHour || minute !== armedMinute) {
      arm()
    }
    watchTimer = setTimer(pollClock, watchIntervalMs)
    watchTimer.unref?.()
  }

  arm()
  pollClock()
  return () => {
    disposed = true
    clearDistill()
    if (watchTimer !== undefined) {
      clearTimer(watchTimer)
      watchTimer = undefined
    }
  }
}

function asClockReader(value: number | (() => number)): () => number {
  return typeof value === 'function' ? value : () => value
}

function compressToLimit(
  document: ParsedMemory,
  important: readonly string[],
  maxBytes: number,
): ParsedMemory {
  const next: ParsedMemory = {
    preamble: '',
    extras: [],
    sections: {
      关于用户: importantLinesOnly(document.sections['关于用户'], important),
      重要事实: importantLinesOnly(document.sections['重要事实'], important),
      近期主题: importantLinesOnly(document.sections['近期主题'], important),
      待办与约定: importantLinesOnly(document.sections['待办与约定'], important),
    },
  }
  if (Buffer.byteLength(serializeMemoryMarkdown(next), 'utf8') <= maxBytes) {
    return next
  }
  next.sections['关于用户'] = ''
  next.sections['近期主题'] = ''
  next.sections['待办与约定'] = ''
  return next
}

function importantLinesOnly(body: string, important: readonly string[]): string {
  return body
    .split(/\r?\n/u)
    .filter((line) => important.some((fact) => line.includes(normalizeFact(fact)) || fact.includes(line.trim())))
    .join('\n')
}

function normalizeFact(fact: string): string {
  return fact.replace(/^- /u, '').replace(/重要/gu, '').replace(/\s+/gu, ' ').trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
