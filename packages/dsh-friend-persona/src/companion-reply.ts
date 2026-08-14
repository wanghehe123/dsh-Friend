/**
 * Host-side companion-reply subscription.
 *
 * Official observation surface (`@deepseek-ai/dsh-session` 0.1.0-rc.6):
 * `ctx.on('session/event', (session, event) => …)` — post-commit append
 * feed (`lib/types/index.d.ts` 56–66). The live {@link Agent} handle
 * (`@deepseek-ai/dsh-agent` `lib/types/runtime-types.d.ts` 60–132) has
 * `followup` / `send` / `steer` / `inject` / `cancel` / `whenIdle` and a
 * `session` log, but **no** output iterator or chunk callback.
 *
 * Event vocabulary that carries assistant text
 * (`dsh-session/lib/types/types.d.ts`):
 * - `assistant/chunk` (263–268) → `StreamChunk` `text-delta`
 *   (`dsh-llm/lib/types/types.d.ts` 272–274)
 * - `assistant/message` (275–280) — assembled step (fallback when no chunks)
 * - `turn/start` / `turn/end` (230–244) — reset / done
 *
 * This module is the injectable seam. The shared compat wrapper this should
 * become is documented on {@link wrapContextSessionEvents}. Feature packages
 * must not `import '@deepseek-ai/dsh-session'` at runtime.
 */

import { FRIEND_PRESET_IDS } from '@wish233/dsh-friend-shared'

/** Official Cordis event name from `@deepseek-ai/dsh-session`. */
export const SESSION_EVENT_NAME = 'session/event' as const

export type CompanionReplyDelta = Readonly<{
  sessionId: string
  /** Raw model text for this tick (empty on reset / done). */
  rawDelta: string
  done: boolean
  mode: 'append' | 'replace'
  /** Start of a new turn — consumers must drop prior parser / speak state. */
  reset: boolean
}>

export type CompanionReplyListener = (delta: CompanionReplyDelta) => void

export type CompanionSessionInfo = Readonly<{
  sessionId: string
  presetId?: string
}>

export type CompanionSessionFilter = (info: CompanionSessionInfo) => boolean

/**
 * Raw session/event source. Production wraps `ctx.on('session/event')`.
 * Tests inject a fake so this stays replaceable when shared grows a compat.
 */
export type SessionEventSource = {
  subscribe(handler: (session: unknown, event: unknown) => void): () => void
}

export type FriendSessionEventContext = {
  on?: ((event: string, handler: (...args: unknown[]) => unknown) => unknown) | undefined
}

export type InspectedSessionEvent =
  | { kind: 'turn-start' }
  | { kind: 'text-delta'; text: string }
  | { kind: 'message'; text: string }
  | { kind: 'turn-end' }

export type CompanionReplyHub = {
  subscribe(listener: CompanionReplyListener): () => void
  attachSource(source: SessionEventSource, options?: SubscribeCompanionRepliesOptions): () => void
  notify(delta: CompanionReplyDelta): void
  dispose(): void
}

export type SubscribeCompanionRepliesOptions = {
  filter?: CompanionSessionFilter
}

const COMPANION_PRESET_VALUES: readonly string[] = [
  FRIEND_PRESET_IDS.companion,
  FRIEND_PRESET_IDS.companionPlus,
]

export function isCompanionPresetId(presetId: string | undefined): boolean {
  if (presetId === undefined) {
    return false
  }
  return COMPANION_PRESET_VALUES.includes(presetId)
}

export function createCompanionSessionFilter(options: {
  getStandingSessionId?: () => string | undefined
} = {}): CompanionSessionFilter {
  return (info) => {
    if (isCompanionPresetId(info.presetId)) {
      return true
    }
    const standing = normalizeId(options.getStandingSessionId?.())
    return standing !== undefined && standing === info.sessionId
  }
}

export function extractSessionIdentity(session: unknown): CompanionSessionInfo | undefined {
  if (!isPlainObject(session)) {
    return undefined
  }
  const header = isPlainObject(session.header) ? session.header : undefined
  const meta = isPlainObject(session.meta) ? session.meta : undefined
  const sessionId = firstString(session.id, session.sessionId, header?.id)
  if (sessionId === undefined) {
    return undefined
  }
  const presetId = firstString(
    session.agentPreset,
    session.presetId,
    header?.agentPreset,
    header?.presetId,
    meta?.agentPreset,
  )
  return presetId === undefined ? { sessionId } : { sessionId, presetId }
}

/**
 * Pull a typed assistant-output fact out of one `session/event` payload.
 * Reasoning deltas are ignored (not display / TTS).
 */
export function inspectSessionEvent(event: unknown): InspectedSessionEvent | undefined {
  if (!isPlainObject(event)) {
    return undefined
  }
  const type = firstString(event.type)
  if (type === undefined) {
    return undefined
  }
  const data = isPlainObject(event.data) ? event.data : event

  if (type === 'turn/start' || type === 'turn-start') {
    return { kind: 'turn-start' }
  }
  if (type === 'turn/end' || type === 'turn-end' || type === 'turn-success') {
    return { kind: 'turn-end' }
  }
  if (type === 'assistant/chunk') {
    const chunk = isPlainObject(data.chunk) ? data.chunk : undefined
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
      return { kind: 'text-delta', text: chunk.text }
    }
    return undefined
  }
  if (type === 'assistant/message') {
    const text = textFromAssistantMessage(data.message)
    if (text === undefined) {
      return undefined
    }
    return { kind: 'message', text }
  }
  return undefined
}

/**
 * Wrap `ctx.on('session/event')` without a runtime `@deepseek-ai/*` import.
 *
 * Official: `Context.on` (`@deepseek-ai/cordis` `lib/types/events.d.ts` 187–197)
 * + event name `session/event` (`@deepseek-ai/dsh-session`).
 *
 * Needed shared compat (cannot add this round):
 * `subscribeSessionEvents(ctx, listener) → () => void`
 * wrapping `ctx.on('session/event', (session, event) => listener(session, event))`.
 */
export function wrapContextSessionEvents(
  ctx: FriendSessionEventContext,
): SessionEventSource | undefined {
  if (typeof ctx.on !== 'function') {
    return undefined
  }
  const on = ctx.on.bind(ctx)
  return {
    subscribe(handler) {
      const dispose = on(SESSION_EVENT_NAME, (...args: unknown[]) => {
        const { session, event } = normalizeSessionEventArgs(args)
        handler(session, event)
      })
      return () => {
        if (typeof dispose === 'function') {
          dispose()
        }
      }
    },
  }
}

export function subscribeCompanionReplies(
  source: SessionEventSource,
  listener: CompanionReplyListener,
  options: SubscribeCompanionRepliesOptions = {},
): () => void {
  const filter = options.filter
  const turnState = new Map<string, { sawTextDelta: boolean }>()

  return source.subscribe((session, event) => {
    const identity = extractSessionIdentity(session)
    if (identity === undefined) {
      return
    }
    if (filter !== undefined && !filter(identity)) {
      return
    }
    const inspected = inspectSessionEvent(event)
    if (inspected === undefined) {
      return
    }

    const state = turnState.get(identity.sessionId) ?? { sawTextDelta: false }

    if (inspected.kind === 'turn-start') {
      turnState.set(identity.sessionId, { sawTextDelta: false })
      listener({
        sessionId: identity.sessionId,
        rawDelta: '',
        done: false,
        mode: 'replace',
        reset: true,
      })
      return
    }

    if (inspected.kind === 'text-delta') {
      state.sawTextDelta = true
      turnState.set(identity.sessionId, state)
      listener({
        sessionId: identity.sessionId,
        rawDelta: inspected.text,
        done: false,
        mode: 'append',
        reset: false,
      })
      return
    }

    if (inspected.kind === 'message') {
      if (state.sawTextDelta) {
        return
      }
      listener({
        sessionId: identity.sessionId,
        rawDelta: inspected.text,
        done: false,
        mode: 'replace',
        reset: false,
      })
      return
    }

    turnState.delete(identity.sessionId)
    listener({
      sessionId: identity.sessionId,
      rawDelta: '',
      done: true,
      mode: 'append',
      reset: false,
    })
  })
}

export function createCompanionReplyHub(): CompanionReplyHub {
  const listeners = new Set<CompanionReplyListener>()
  const stops: Array<() => void> = []

  const notify = (delta: CompanionReplyDelta): void => {
    for (const listener of listeners) {
      listener(delta)
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    attachSource(source, options) {
      const stop = subscribeCompanionReplies(source, notify, options)
      stops.push(stop)
      return () => {
        stop()
        const index = stops.indexOf(stop)
        if (index >= 0) {
          stops.splice(index, 1)
        }
      }
    },
    notify,
    dispose() {
      for (const stop of stops.splice(0).reverse()) {
        stop()
      }
      listeners.clear()
    },
  }
}

let sharedHub = createCompanionReplyHub()

export function getSharedCompanionReplyHub(): CompanionReplyHub {
  return sharedHub
}

export function resetSharedCompanionReplyHub(): void {
  sharedHub.dispose()
  sharedHub = createCompanionReplyHub()
}

export function normalizeSessionEventArgs(args: readonly unknown[]): {
  session: unknown
  event: unknown
} {
  if (args.length >= 2) {
    return { session: args[0], event: args[1] }
  }
  const first = args[0]
  if (isPlainObject(first) && first.session !== undefined && first.event !== undefined) {
    return { session: first.session, event: first.event }
  }
  return { session: first, event: first }
}

function textFromAssistantMessage(message: unknown): string | undefined {
  if (!isPlainObject(message)) {
    return undefined
  }
  const content = message.content
  if (!Array.isArray(content)) {
    return typeof message.text === 'string' && message.text.length > 0
      ? message.text
      : undefined
  }
  let text = ''
  for (const block of content) {
    if (isPlainObject(block) && block.type === 'text' && typeof block.text === 'string') {
      text += block.text
    }
  }
  return text.length > 0 ? text : undefined
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return undefined
}

function normalizeId(id: string | undefined): string | undefined {
  if (id === undefined) {
    return undefined
  }
  const trimmed = id.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
