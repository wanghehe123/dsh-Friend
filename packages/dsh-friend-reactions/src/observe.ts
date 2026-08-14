import { FRIEND_PRESET_IDS } from '@wish233/dsh-friend-shared'

/**
 * Internal work-event kinds derived from real `SessionEventMap` keys
 * (`@deepseek-ai/dsh-session` `lib/types/types.d.ts` 223–354).
 *
 * Mapping (DSH type → kind):
 * - `turn/start` → `turn-start`
 * - `turn/end` with `data.reason.kind === 'completed'` → `turn-success`
 * - `tool/result` with `data.error` or `message.content[0].isError` → `tool-error`
 *
 * `tool-long` is gone: `tool/result` (`types.d.ts` 304–313) has no duration /
 * elapsed field, so a long-running tool cannot be classified from the payload.
 * `plan-approved` is gone: that name is not a `SessionEventMap` key.
 */
export const WORK_EVENT_KINDS = [
  'turn-start',
  'tool-error',
  'turn-success',
] as const

export type WorkEventKind = (typeof WORK_EVENT_KINDS)[number]

/**
 * Internal work event. Only metadata — never user text, model output,
 * or file contents. The field set is closed so a privacy test can assert
 * the absence of `payload` / `text` / `content`.
 */
export type WorkEvent = {
  kind: WorkEventKind
  sessionId: string
  ok?: boolean
}

export const COMPANION_PRESET_IDS = [
  FRIEND_PRESET_IDS.companion,
  FRIEND_PRESET_IDS.companionPlus,
] as const

/**
 * Official `session/event` feed (`dsh-session` `lib/types/index.d.ts` 66):
 * `(session, event)`. Tests that inject a fake must keep this arity.
 */
export type SessionEventSource = {
  subscribe(handler: (session: unknown, event: unknown) => void): () => void
}

export type ObserveOptions = {
  mutedSessions?: readonly string[]
}

const SECRET_KEYS = [
  'payload',
  'text',
  'content',
  'message',
  'messages',
  'file',
  'files',
  'input',
  'output',
  'prompt',
  'reply',
  'body',
] as const

export function isCompanionPreset(presetId: string | undefined): boolean {
  if (presetId === undefined) {
    return false
  }
  return (COMPANION_PRESET_IDS as readonly string[]).includes(presetId)
}

/**
 * Normalize one official `session/event` pair into zero or one work events.
 * Companion presets, muted sessions, and unrecognised DSH types are dropped.
 *
 * `session.header.agentPreset` is the durable preset id
 * (`SessionHeader.agentPreset`, `types.d.ts` 71–77).
 */
export function observeRawEvent(
  session: unknown,
  event: unknown,
  options: ObserveOptions = {},
): WorkEvent | undefined {
  const extracted = extractMetadata(session, event)
  if (extracted === undefined) {
    return undefined
  }
  if (isCompanionPreset(extracted.presetId)) {
    return undefined
  }
  if ((options.mutedSessions ?? []).includes(extracted.sessionId)) {
    return undefined
  }
  const kind = classify(extracted)
  if (kind === undefined) {
    return undefined
  }
  const work: WorkEvent = {
    kind,
    sessionId: extracted.sessionId,
  }
  if (extracted.ok !== undefined) {
    work.ok = extracted.ok
  }
  return work
}

export function assertPrivateEvent(event: WorkEvent): void {
  for (const key of SECRET_KEYS) {
    if (Object.hasOwn(event, key)) {
      throw new Error(`dsh-friend-reactions: internal event leaked "${key}"`)
    }
  }
}

type Extracted = {
  type: string
  sessionId: string
  presetId?: string
  ok?: boolean
  error?: boolean
}

function extractMetadata(session: unknown, event: unknown): Extracted | undefined {
  if (!isPlainObject(session) || !isPlainObject(event)) {
    return undefined
  }
  const type = firstString(event.type)
  const sessionId = firstString(session.id, session.sessionId)
  if (type === undefined || sessionId === undefined) {
    return undefined
  }
  const header = isPlainObject(session.header) ? session.header : undefined
  const presetId = firstString(header?.agentPreset)
  const data = isPlainObject(event.data) ? event.data : undefined
  const reason = isPlainObject(data?.reason) ? data.reason : undefined
  const reasonKind = firstString(reason?.kind)
  const toolError = toolResultIsError(data)
  const extracted: Extracted = { type, sessionId }
  if (presetId !== undefined) {
    extracted.presetId = presetId
  }
  if (reasonKind === 'completed') {
    extracted.ok = true
  } else if (reasonKind !== undefined) {
    extracted.ok = false
  }
  if (toolError) {
    extracted.error = true
    extracted.ok = false
  }
  return extracted
}

/**
 * `tool/result` error facts (`types.d.ts` 304–313 + `ToolResultBlock.isError`
 * in `dsh-llm` `lib/types/types.d.ts` 69–74). Text of the result is ignored.
 */
function toolResultIsError(data: Record<string, unknown> | undefined): boolean {
  if (data === undefined) {
    return false
  }
  if (isPlainObject(data.error)) {
    return firstString(data.error.name, data.error.code) !== undefined
  }
  const message = isPlainObject(data.message) ? data.message : undefined
  const content = Array.isArray(message?.content) ? message.content : []
  const block = isPlainObject(content[0]) ? content[0] : undefined
  return block?.type === 'tool-result' && block.isError === true
}

function classify(extracted: Extracted): WorkEventKind | undefined {
  if (extracted.type === 'turn/start') {
    return 'turn-start'
  }
  if (extracted.type === 'turn/end') {
    if (extracted.ok === true) {
      return 'turn-success'
    }
    return undefined
  }
  if (extracted.type === 'tool/result' && extracted.error === true) {
    return 'tool-error'
  }
  return undefined
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
