import { describe, expect, it } from 'vitest'

import {
  companionTurnEndFromSessionEvent,
  normalizeSessionEventArgs,
  wrapHostTurnEndSource,
} from '../src/turn-end.ts'

const companionSession = {
  id: 'friend-companion-1',
  header: { agentPreset: 'friend-companion' },
  events: [
    { type: 'turn/start', data: { turn: 2 } },
    {
      type: 'user/message',
      data: { role: 'user', content: [{ type: 'text', text: '今天加班' }] },
    },
    {
      type: 'assistant/message',
      data: { turn: 2, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '辛苦了' }] } },
    },
    { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
  ],
}

describe('companionTurnEndFromSessionEvent', () => {
  it('maps official turn/end + session log onto CompanionTurnEnd', () => {
    expect(companionTurnEndFromSessionEvent(companionSession, {
      type: 'turn/end',
      data: { turn: 2, reason: { kind: 'completed' } },
    })).toEqual({
      sessionId: 'friend-companion-1',
      turnId: '2',
      presetId: 'friend-companion',
      messages: [
        { role: 'user', text: '今天加班' },
        { role: 'assistant', text: '辛苦了' },
      ],
    })
  })

  it('ignores non-turn/end vocabulary and failed turns', () => {
    expect(companionTurnEndFromSessionEvent(companionSession, {
      type: 'assistant/chunk',
      data: { chunk: { type: 'text-delta', text: 'x' } },
    })).toBeUndefined()
    expect(companionTurnEndFromSessionEvent(companionSession, {
      type: 'turn/end',
      data: { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } },
    })).toBeUndefined()
    expect(companionTurnEndFromSessionEvent(companionSession, {
      type: 'turn/end',
      data: { turn: 2, reason: { kind: 'error', error: { message: 'x', code: 'UNKNOWN' } } },
    })).toBeUndefined()
  })
})

describe('wrapHostTurnEndSource', () => {
  it('forwards both official (session, event) arguments from ctx.on', () => {
    const seen: Array<{ sessionId: string; turnId: string }> = []
    const source = wrapHostTurnEndSource({
      on(event, handler) {
        expect(event).toBe('session/event')
        handler(companionSession, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
        return () => undefined
      },
    })
    expect(source).toBeDefined()
    source?.subscribe((turn) => {
      seen.push({ sessionId: turn.sessionId, turnId: turn.turnId })
    })
    expect(seen).toEqual([{ sessionId: 'friend-companion-1', turnId: '2' }])
  })

  it('returns undefined when ctx.on is missing', () => {
    expect(wrapHostTurnEndSource({})).toBeUndefined()
  })
})

describe('normalizeSessionEventArgs', () => {
  it('prefers the official two-argument (session, event) signature', () => {
    expect(normalizeSessionEventArgs(['sess', 'evt'])).toEqual({ session: 'sess', event: 'evt' })
  })
})
