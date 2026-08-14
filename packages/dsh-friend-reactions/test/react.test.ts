import { afterEach, describe, expect, it, vi } from 'vitest'

import { createReactEngine } from '../src/react.ts'
import { DEFAULT_REACTION_SETTINGS, type ReactionSettings } from '../src/settings.ts'
import type { WorkEvent } from '../src/observe.ts'

function event(kind: WorkEvent['kind'], sessionId = 's1'): WorkEvent {
  return { kind, sessionId }
}

function settings(overrides: Partial<ReactionSettings> = {}): () => ReactionSettings {
  return () => ({
    ...DEFAULT_REACTION_SETTINGS,
    quietHours: [],
    quietCron: [],
    mutedSessions: [],
    ...overrides,
  })
}

describe('reaction throttle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('lets only the first of three dense turn-success events through', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T12:00:00'))
    const engine = createReactEngine({
      settings: settings(),
      now: () => Date.now(),
      random: () => 0,
    })
    const first = engine.react(event('turn-success'))
    vi.advanceTimersByTime(30_000)
    const second = engine.react(event('turn-success'))
    vi.advanceTimersByTime(30_000)
    const third = engine.react(event('turn-success'))
    expect(first?.cue).toBe('success')
    expect(second).toBeUndefined()
    expect(third).toBeUndefined()
  })

  it('does not let same-kind events through before 5 minutes even after the global 45s', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T12:00:00'))
    const engine = createReactEngine({
      settings: settings(),
      now: () => Date.now(),
      random: () => 0,
    })
    expect(engine.react(event('turn-success'))).toBeDefined()
    vi.advanceTimersByTime(46_000)
    expect(engine.react(event('turn-success'))).toBeUndefined()
    vi.advanceTimersByTime(5 * 60_000)
    expect(engine.react(event('turn-success'))).toBeDefined()
  })

  it('does not treat different kinds as mutually exclusive after the global cooldown', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T12:00:00'))
    const engine = createReactEngine({
      settings: settings(),
      now: () => Date.now(),
      random: () => 0,
    })
    expect(engine.react(event('turn-start'))?.motionGroup).toBe('Thinking')
    vi.advanceTimersByTime(46_000)
    expect(engine.react(event('tool-error'))?.expression).toBe('surprised')
  })

  it('bans every reaction inside a quiet-hours window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T23:30:00'))
    const engine = createReactEngine({
      settings: settings({ quietHours: [{ start: '22:00', end: '08:00' }] }),
      now: () => Date.now(),
    })
    expect(engine.react(event('turn-start'))).toBeUndefined()
    expect(engine.react(event('turn-success'))).toBeUndefined()
    expect(engine.react(event('tool-error'))).toBeUndefined()
    expect(engine.decide(event('tool-error'))).toEqual({ allowed: false, reason: 'dnd' })
  })

  it('honors a five-field cron quiet expression', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T22:05:00'))
    const engine = createReactEngine({
      settings: settings({ quietCron: ['* 22 * * *'] }),
      now: () => Date.now(),
    })
    expect(engine.decide(event('turn-success')).allowed).toBe(false)
  })
})
