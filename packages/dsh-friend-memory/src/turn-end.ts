/**
 * Host-side `turn/end` source for auto-summary.
 *
 * Official observation surface (`@deepseek-ai/dsh-session` 0.1.0-rc.6):
 * `ctx.on('session/event', (session, event) => …)` — two arguments
 * (`lib/types/index.d.ts` 56–66). Event vocabulary (`lib/types/types.d.ts`
 * 223–330) includes `turn/start` (230–232), `turn/end` (241–244),
 * `user/message` (262), `assistant/message` (275–280).
 *
 * Feature packages must not `import '@deepseek-ai/dsh-session'` at runtime.
 */

import type { ChatTurn, CompanionTurnEnd, TurnEndSource } from './auto-summary.ts'

/** Official Cordis event name from `@deepseek-ai/dsh-session`. */
export const SESSION_EVENT_NAME = 'session/event' as const

export type FriendSessionEventContext = {
  on?: ((event: string, handler: (...args: unknown[]) => unknown) => unknown) | undefined
}

/**
 * Wrap `ctx.on('session/event')` into a {@link TurnEndSource}.
 * Returns `undefined` when `ctx.on` is missing (test ctx / no session plugin).
 */
export function wrapHostTurnEndSource(ctx: FriendSessionEventContext): TurnEndSource | undefined {
  const on = readContextOn(ctx)
  if (on === undefined) {
    return undefined
  }
  return {
    subscribe(handler) {
      const dispose = on(SESSION_EVENT_NAME, (...args: unknown[]) => {
        const { session, event } = normalizeSessionEventArgs(args)
        const turnEnd = companionTurnEndFromSessionEvent(session, event)
        if (turnEnd !== undefined) {
          handler(turnEnd)
        }
      })
      return () => {
        if (typeof dispose === 'function') {
          dispose()
        }
      }
    },
  }
}

export function companionTurnEndFromSessionEvent(
  session: unknown,
  event: unknown,
): CompanionTurnEnd | undefined {
  if (!isPlainObject(event)) {
    return undefined
  }
  const type = firstString(event.type)
  if (type !== 'turn/end') {
    return undefined
  }
  const data = isPlainObject(event.data) ? event.data : event
  if (!isSuccessfulTurnEnd(data)) {
    return undefined
  }
  const turn = data.turn
  if (typeof turn !== 'number' || !Number.isFinite(turn)) {
    return undefined
  }
  const identity = extractSessionIdentity(session)
  if (identity === undefined) {
    return undefined
  }
  const messages = messagesForTurn(session, turn)
  return {
    sessionId: identity.sessionId,
    turnId: String(turn),
    ...(identity.presetId !== undefined ? { presetId: identity.presetId } : {}),
    messages,
  }
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

function isSuccessfulTurnEnd(data: Record<string, unknown>): boolean {
  const reason = isPlainObject(data.reason) ? data.reason : undefined
  const kind = firstString(reason?.kind)
  return kind === 'completed' || kind === 'max-tokens'
}

function extractSessionIdentity(session: unknown): { sessionId: string; presetId?: string } | undefined {
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

function messagesForTurn(session: unknown, turn: number): ChatTurn[] {
  const events = readSessionEvents(session)
  const messages: ChatTurn[] = []
  let inTurn = false
  for (const raw of events) {
    if (!isPlainObject(raw)) {
      continue
    }
    const type = firstString(raw.type)
    const data = isPlainObject(raw.data) ? raw.data : raw
    if (type === 'turn/start' && data.turn === turn) {
      inTurn = true
      continue
    }
    if (!inTurn) {
      continue
    }
    if (type === 'user/message') {
      const text = textFromContent(data)
      if (text !== undefined) {
        messages.push({ role: 'user', text })
      }
      continue
    }
    if (type === 'assistant/message') {
      const message = isPlainObject(data.message) ? data.message : data
      const text = textFromContent(message)
      if (text !== undefined) {
        messages.push({ role: 'assistant', text })
      }
      continue
    }
    if (type === 'turn/end' && data.turn === turn) {
      break
    }
  }
  return messages
}

function readSessionEvents(session: unknown): readonly unknown[] {
  if (!isPlainObject(session)) {
    return []
  }
  const events = session.events
  return Array.isArray(events) ? events : []
}

function textFromContent(message: Record<string, unknown>): string | undefined {
  const content = message.content
  if (!Array.isArray(content)) {
    return typeof message.text === 'string' && message.text.length > 0 ? message.text : undefined
  }
  let text = ''
  for (const block of content) {
    if (isPlainObject(block) && block.type === 'text' && typeof block.text === 'string') {
      text += block.text
    }
  }
  return text.length > 0 ? text : undefined
}

function readContextOn(
  ctx: FriendSessionEventContext,
): ((event: string, handler: (...args: unknown[]) => unknown) => unknown) | undefined {
  try {
    const on = ctx.on
    return typeof on === 'function' ? on : undefined
  } catch {
    // createStrictCordisCtx throws on undeclared props; `on` is a Cordis
    // intrinsic, not an inject service.
    return undefined
  }
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
