import { describe, expect, it } from 'vitest'

import {
  assertPrivateEvent,
  observeRawEvent,
  type WorkEvent,
} from '../src/observe.ts'

const SECRET = '用户说的秘密和文件内容.txt'

function codingSession(id = 'code-1', preset = 'coding'): { id: string; header: { agentPreset: string } } {
  return { id, header: { agentPreset: preset } }
}

function companionSession(id: string, preset: 'friend-companion' | 'friend-companion-plus') {
  return { id, header: { agentPreset: preset } }
}

function keysOf(event: WorkEvent): string[] {
  return Object.keys(event).sort()
}

describe('session event filter + normalize', () => {
  it('keeps coding-session metadata and drops companion turns in a mixed official stream', () => {
    const stream: Array<{ session: unknown; event: unknown }> = [
      { session: codingSession(), event: { type: 'turn/start', data: { turn: 1 } } },
      {
        session: companionSession('friend-1', 'friend-companion'),
        event: { type: 'turn/start', data: { turn: 1 }, text: SECRET },
      },
      {
        session: codingSession(),
        event: {
          type: 'turn/end',
          data: { turn: 1, reason: { kind: 'completed' } },
          content: SECRET,
        },
      },
      {
        session: companionSession('friend-2', 'friend-companion-plus'),
        event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, payload: { text: SECRET } },
      },
      {
        session: codingSession(),
        event: {
          type: 'tool/result',
          data: { error: { name: 'ToolError', code: 'FAILED' }, message: { content: [{ type: 'tool-result', isError: true }] } },
        },
      },
      {
        session: codingSession(),
        event: { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', isError: false }] } } },
      },
      { session: codingSession(), event: { type: 'user/message', data: { content: SECRET } } },
    ]

    const seen = stream
      .map((item) => observeRawEvent(item.session, item.event))
      .filter((event): event is WorkEvent => event !== undefined)
    expect(seen.map((event) => event.kind)).toEqual([
      'turn-start',
      'turn-success',
      'tool-error',
    ])
    expect(seen.every((event) => event.sessionId === 'code-1')).toBe(true)
  })

  it('reads presetId from session.header.agentPreset, not a flat root field', () => {
    expect(observeRawEvent(
      { id: 'flat-lie', agentPreset: 'friend-companion', presetId: 'friend-companion' },
      { type: 'turn/start', data: { turn: 1 } },
    )?.kind).toBe('turn-start')
    expect(observeRawEvent(
      { id: 'real-companion', header: { agentPreset: 'friend-companion' } },
      { type: 'turn/start', data: { turn: 1 } },
    )).toBeUndefined()
  })

  it('drops invented kinds that DSH never emits', () => {
    const session = codingSession()
    expect(observeRawEvent(session, { type: 'plan-approved' })).toBeUndefined()
    expect(observeRawEvent(session, { type: 'tool-long' })).toBeUndefined()
    expect(observeRawEvent(session, { type: 'tool', data: { durationMs: 45_000 } })).toBeUndefined()
    expect(observeRawEvent(session, { type: 'turn-success' })).toBeUndefined()
  })

  it('treats turn/end as success only when data.reason.kind is completed', () => {
    const session = codingSession()
    expect(observeRawEvent(session, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    })?.kind).toBe('turn-success')
    expect(observeRawEvent(session, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'error', error: { message: 'no key', code: 'UNKNOWN' } } },
    })).toBeUndefined()
    expect(observeRawEvent(session, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } },
    })).toBeUndefined()
  })

  it('never copies user text, model output, or file fields onto the internal event', () => {
    const event = observeRawEvent(
      codingSession('code-9'),
      {
        type: 'turn/end',
        data: { turn: 1, reason: { kind: 'completed' } },
        text: SECRET,
        content: SECRET,
        payload: { message: SECRET, file: SECRET },
        messages: [{ role: 'user', text: SECRET }],
      },
    )
    expect(event).toBeDefined()
    if (event === undefined) {
      return
    }
    assertPrivateEvent(event)
    expect(keysOf(event)).toEqual(['kind', 'ok', 'sessionId'])
    expect(JSON.stringify(event)).not.toContain(SECRET)
    expect(event).not.toHaveProperty('payload')
    expect(event).not.toHaveProperty('text')
    expect(event).not.toHaveProperty('content')
  })

  it('drops muted sessions', () => {
    expect(observeRawEvent(
      { id: 'quiet', header: { agentPreset: 'coding' } },
      { type: 'turn/end', data: { reason: { kind: 'completed' } } },
      { mutedSessions: ['quiet'] },
    )).toBeUndefined()
  })

  it('returns undefined when only a Session is supplied (the old args[0] shape)', () => {
    expect(observeRawEvent({ id: 'code-1', header: { agentPreset: 'coding' } }, undefined)).toBeUndefined()
  })
})
