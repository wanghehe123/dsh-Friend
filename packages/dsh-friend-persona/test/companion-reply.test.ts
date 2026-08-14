import { afterEach, describe, expect, it, vi } from 'vitest'

import { FRIEND_PRESET_IDS } from '@wish233/dsh-friend-shared'

import {
  createCompanionReplyHub,
  createCompanionSessionFilter,
  extractSessionIdentity,
  inspectSessionEvent,
  isCompanionPresetId,
  normalizeSessionEventArgs,
  resetSharedCompanionReplyHub,
  subscribeCompanionReplies,
  wrapContextSessionEvents,
} from '../src/companion-reply.ts'

afterEach(() => {
  resetSharedCompanionReplyHub()
})

function companionSession(id = 'friend-companion-1') {
  return { id, header: { agentPreset: FRIEND_PRESET_IDS.companion } }
}

describe('inspectSessionEvent', () => {
  it('reads assistant/chunk text-delta and ignores reasoning', () => {
    expect(inspectSessionEvent({
      type: 'assistant/chunk',
      data: { chunk: { type: 'text-delta', text: '你好' } },
    })).toEqual({ kind: 'text-delta', text: '你好' })
    expect(inspectSessionEvent({
      type: 'assistant/chunk',
      data: { chunk: { type: 'reasoning-delta', text: 'thinking' } },
    })).toBeUndefined()
  })

  it('reads assistant/message text blocks and turn boundaries', () => {
    expect(inspectSessionEvent({
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '完整一句' }] } },
    })).toEqual({ kind: 'message', text: '完整一句' })
    expect(inspectSessionEvent({ type: 'turn/start', data: { turn: 1 } })).toEqual({ kind: 'turn-start' })
    expect(inspectSessionEvent({ type: 'turn/end', data: { turn: 1 } })).toEqual({ kind: 'turn-end' })
  })
})

describe('companion session filter', () => {
  it('keeps companion presets and the standing session id', () => {
    expect(isCompanionPresetId(FRIEND_PRESET_IDS.companion)).toBe(true)
    expect(isCompanionPresetId('standard')).toBe(false)
    const filter = createCompanionSessionFilter({ getStandingSessionId: () => 'stand-1' })
    expect(filter({ sessionId: 'other', presetId: FRIEND_PRESET_IDS.companionPlus })).toBe(true)
    expect(filter({ sessionId: 'stand-1' })).toBe(true)
    expect(filter({ sessionId: 'coding', presetId: 'standard' })).toBe(false)
  })

  it('reads id and preset from the official session header shape', () => {
    expect(extractSessionIdentity(companionSession())).toEqual({
      sessionId: 'friend-companion-1',
      presetId: FRIEND_PRESET_IDS.companion,
    })
  })
})

describe('subscribeCompanionReplies', () => {
  it('streams text-delta, skips a later assembled message, and marks turn/end done', () => {
    const handlers: Array<(session: unknown, event: unknown) => void> = []
    const source = {
      subscribe(handler: (session: unknown, event: unknown) => void) {
        handlers.push(handler)
        return () => undefined
      },
    }
    const deltas: Array<{ rawDelta: string; done: boolean; mode: string; reset: boolean }> = []
    subscribeCompanionReplies(source, (delta) => {
      deltas.push({
        rawDelta: delta.rawDelta,
        done: delta.done,
        mode: delta.mode,
        reset: delta.reset,
      })
    })
    const session = companionSession()
    const emit = handlers[0]
    expect(emit).toBeDefined()
    emit?.(session, { type: 'turn/start', data: { turn: 1 } })
    emit?.(session, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '你' } } })
    emit?.(session, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '好' } } })
    emit?.(session, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '你好' }] } },
    })
    emit?.(session, { type: 'turn/end', data: { turn: 1 } })
    expect(deltas).toEqual([
      { rawDelta: '', done: false, mode: 'replace', reset: true },
      { rawDelta: '你', done: false, mode: 'append', reset: false },
      { rawDelta: '好', done: false, mode: 'append', reset: false },
      { rawDelta: '', done: true, mode: 'append', reset: false },
    ])
  })

  it('falls back to assistant/message when the adapter emitted no chunks', () => {
    const handlers: Array<(session: unknown, event: unknown) => void> = []
    const source = {
      subscribe(handler: (session: unknown, event: unknown) => void) {
        handlers.push(handler)
        return () => undefined
      },
    }
    const texts: string[] = []
    subscribeCompanionReplies(source, (delta) => {
      if (delta.rawDelta.length > 0) texts.push(delta.rawDelta)
    }, { filter: createCompanionSessionFilter() })
    handlers[0]?.(companionSession(), {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '没有流式' }] } },
    })
    expect(texts).toEqual(['没有流式'])
  })

  it('drops non-companion sessions (same privacy boundary as reactions, inverted)', () => {
    const handlers: Array<(session: unknown, event: unknown) => void> = []
    const source = {
      subscribe(handler: (session: unknown, event: unknown) => void) {
        handlers.push(handler)
        return () => undefined
      },
    }
    const listener = vi.fn()
    subscribeCompanionReplies(source, listener, { filter: createCompanionSessionFilter() })
    handlers[0]?.(
      { id: 'coding-1', header: { agentPreset: 'standard' } },
      { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'leak' } } },
    )
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('wrapContextSessionEvents', () => {
  it('forwards both official (session, event) arguments from ctx.on', () => {
    const listeners: Array<(...args: unknown[]) => void> = []
    const ctx = {
      on(event: string, handler: (...args: unknown[]) => void) {
        expect(event).toBe('session/event')
        listeners.push(handler)
        return () => undefined
      },
    }
    const seen: unknown[] = []
    const source = wrapContextSessionEvents(ctx)
    source?.subscribe((session, event) => {
      seen.push(session, event)
    })
    listeners[0]?.({ id: 's1' }, { type: 'turn/end' })
    expect(seen).toEqual([{ id: 's1' }, { type: 'turn/end' }])
    expect(normalizeSessionEventArgs([{ session: { id: 'a' }, event: { type: 'x' } }])).toEqual({
      session: { id: 'a' },
      event: { type: 'x' },
    })
  })

  it('returns undefined when ctx.on is missing (injectable seam, no invented API)', () => {
    expect(wrapContextSessionEvents({})).toBeUndefined()
  })
})

describe('CompanionReplyHub', () => {
  it('fans notify out to subscribers', () => {
    const hub = createCompanionReplyHub()
    const seen: string[] = []
    hub.subscribe((delta) => {
      seen.push(delta.rawDelta)
    })
    hub.notify({
      sessionId: 's',
      rawDelta: 'hi',
      done: false,
      mode: 'append',
      reset: false,
    })
    expect(seen).toEqual(['hi'])
    hub.dispose()
  })
})
