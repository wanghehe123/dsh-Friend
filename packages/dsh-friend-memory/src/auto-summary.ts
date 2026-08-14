import { readFile } from 'node:fs/promises'

import { FRIEND_PRESET_IDS } from '@wish233/dsh-friend-shared'

import { lockedAtomicWrite } from './atomic.ts'
import { runPrompt, type MemoryLlm } from './llm.ts'
import { watermarkPath } from './paths.ts'
import {
  buildExtractionUserPrompt,
  EXTRACTION_SYSTEM_PROMPT,
  isExtractedOutputOversized,
  parseExtractedFacts,
} from './prompts.ts'
import type { MemorySettings } from './settings.ts'
import { parseDailyEntries, type MemoryStore } from './store.ts'

export const COMPANION_PRESET_IDS = [
  FRIEND_PRESET_IDS.companion,
  FRIEND_PRESET_IDS.companionPlus,
] as const

export type ChatTurn = {
  role: 'user' | 'assistant'
  text: string
}

export type CompanionTurnEnd = {
  sessionId: string
  turnId: string
  presetId?: string
  messages: readonly ChatTurn[]
}

export type TurnEndSource = {
  subscribe(handler: (event: CompanionTurnEnd) => void): () => void
}

export type AutoSummaryWatermark = {
  sessionId: string
  lastTurnId: string
}

export type AutoSummaryOptions = {
  store: MemoryStore
  llm: MemoryLlm
  settings: () => MemorySettings
  now?: () => Date
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

export type AutoSummaryHandle = {
  notify(event: CompanionTurnEnd): void
  flush(): Promise<void>
  dispose(): void
}

export function isCompanionPreset(presetId: string | undefined): boolean {
  if (presetId === undefined) {
    return false
  }
  return (COMPANION_PRESET_IDS as readonly string[]).includes(presetId)
}

export function createAutoSummary(options: AutoSummaryOptions): AutoSummaryHandle {
  const now = options.now ?? (() => new Date())
  const setTimer = options.setTimeoutFn ?? setTimeout
  const clearTimer = options.clearTimeoutFn ?? clearTimeout
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: CompanionTurnEnd | undefined
  let running: Promise<unknown> = Promise.resolve()

  const dispose = (): void => {
    if (timer !== undefined) {
      clearTimer(timer)
      timer = undefined
    }
    pending = undefined
  }

  const notify = (event: CompanionTurnEnd): void => {
    const settings = options.settings()
    if (!settings.enabled || !settings.autoSummaryEnabled) {
      return
    }
    if (!isCompanionPreset(event.presetId)) {
      return
    }
    pending = event
    if (timer !== undefined) {
      clearTimer(timer)
    }
    const delayMs = settings.autoSummaryIdleMinutes * 60_000
    timer = setTimer(() => {
      timer = undefined
      const current = pending
      pending = undefined
      if (current === undefined) {
        return
      }
      running = running.then(() => summarizeTurn(options.store, options.llm, current, now))
    }, delayMs)
    timer.unref?.()
  }

  return {
    notify,
    async flush() {
      if (timer !== undefined) {
        clearTimer(timer)
        timer = undefined
      }
      const current = pending
      pending = undefined
      if (current !== undefined) {
        running = running.then(() => summarizeTurn(options.store, options.llm, current, now))
      }
      await running
    },
    dispose,
  }
}

export function bindTurnEndSource(
  source: TurnEndSource,
  handle: AutoSummaryHandle,
): () => void {
  return source.subscribe((event) => {
    handle.notify(event)
  })
}

export async function summarizeTurn(
  store: MemoryStore,
  llm: MemoryLlm,
  event: CompanionTurnEnd,
  now: () => Date = () => new Date(),
): Promise<{ wrote: boolean; reason: string }> {
  return store.runWithCapturedDir(() => summarizeTurnCaptured(store, llm, event, now))
}

async function summarizeTurnCaptured(
  store: MemoryStore,
  llm: MemoryLlm,
  event: CompanionTurnEnd,
  now: () => Date,
): Promise<{ wrote: boolean; reason: string }> {
  const watermark = await readWatermark(store)
  if (watermark !== undefined && watermark.sessionId === event.sessionId && watermark.lastTurnId === event.turnId) {
    return { wrote: false, reason: 'idempotent' }
  }

  const transcript = event.messages
    .map((message) => `${message.role}: ${message.text}`)
    .join('\n')
    .trim()
  if (transcript.length === 0) {
    await writeWatermark(store, { sessionId: event.sessionId, lastTurnId: event.turnId })
    return { wrote: false, reason: 'empty-transcript' }
  }

  const existing = parseDailyEntries(await store.readDailyRaw()).map((entry) => entry.text)

  let raw: string
  try {
    raw = await runPrompt(llm, {
      system: EXTRACTION_SYSTEM_PROMPT,
      user: buildExtractionUserPrompt({ transcript, existing }),
    })
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error)
    console.warn(`dsh-friend-memory: auto-summary LLM failed (${cause}); daily notes unchanged`)
    return { wrote: false, reason: 'llm-error' }
  }

  if (isExtractedOutputOversized(raw)) {
    console.warn('dsh-friend-memory: auto-summary LLM output too long; daily notes unchanged')
    await writeWatermark(store, { sessionId: event.sessionId, lastTurnId: event.turnId })
    return { wrote: false, reason: 'oversized' }
  }

  const facts = parseExtractedFacts(raw)
  if (facts.length === 0) {
    await writeWatermark(store, { sessionId: event.sessionId, lastTurnId: event.turnId })
    return { wrote: false, reason: 'empty-facts' }
  }

  for (const fact of facts) {
    await store.appendDaily({
      text: fact,
      source: 'chat',
      time: formatNow(now()),
    })
  }
  await writeWatermark(store, { sessionId: event.sessionId, lastTurnId: event.turnId })
  return { wrote: true, reason: 'ok' }
}

export async function readWatermark(store: MemoryStore): Promise<AutoSummaryWatermark | undefined> {
  try {
    const raw = await readFile(watermarkPath(store.dataDir, store.slug), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined
    }
    const record = parsed as Record<string, unknown>
    if (typeof record.sessionId !== 'string' || typeof record.lastTurnId !== 'string') {
      return undefined
    }
    return { sessionId: record.sessionId, lastTurnId: record.lastTurnId }
  } catch {
    return undefined
  }
}

async function writeWatermark(store: MemoryStore, watermark: AutoSummaryWatermark): Promise<void> {
  await lockedAtomicWrite(
    watermarkPath(store.dataDir, store.slug),
    `${JSON.stringify(watermark, null, 2)}\n`,
  )
}

function formatNow(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}
