import { describe, expect, it } from 'vitest'

import { createReactEngine } from '../src/react.ts'
import { attachQuip, createQuipPicker, QUIP_WINDOW, quipsFor } from '../src/quips.ts'
import { DEFAULT_REACTION_SETTINGS, type ReactionSettings } from '../src/settings.ts'
import type { WorkEventKind } from '../src/observe.ts'

const KINDS: WorkEventKind[] = [
  'turn-start',
  'tool-error',
  'turn-success',
]

function settings(overrides: Partial<ReactionSettings> = {}): () => ReactionSettings {
  return () => ({
    ...DEFAULT_REACTION_SETTINGS,
    quietHours: [],
    quietCron: [],
    mutedSessions: [],
    ...overrides,
  })
}

describe('quip banks and levels', () => {
  it('ships at least 8 lines per event kind in zh and en', () => {
    for (const language of ['zh', 'en']) {
      const bank = quipsFor(language)
      for (const kind of KINDS) {
        expect(bank[kind].length, `${language} ${kind}`).toBeGreaterThanOrEqual(8)
      }
    }
  })

  it('does not repeat a line inside the last-3 window', () => {
    let step = 0
    const picker = createQuipPicker(() => {
      const value = step
      step += 1
      return (value % 1000) / 1000
    })
    const seen: string[] = []
    for (let index = 0; index < 8; index += 1) {
      const line = picker.pick('turn-success', 'zh')
      const window = seen.slice(-QUIP_WINDOW)
      expect(window).not.toContain(line)
      seen.push(line)
    }
  })

  it('action level has no quip; bubble adds one; voice enqueues TTS once', () => {
    expect(attachQuip('action', 'turn-success', 'zh', createQuipPicker(() => 0))).toBeUndefined()

    const spoken: string[] = []
    const bubble = createReactEngine({
      settings: settings({ level: 'bubble' }),
      now: () => 1_000,
      random: () => 0,
    })
    const withQuip = bubble.react({ kind: 'turn-success', sessionId: 's' })
    expect(withQuip?.quip).toBeTruthy()
    expect(withQuip?.expression).toBe('happy')

    const voice = createReactEngine({
      settings: settings({ level: 'voice' }),
      now: () => 1_000,
      random: () => 0,
      enqueueTts: (text) => {
        spoken.push(text)
      },
    })
    const voiced = voice.react({ kind: 'tool-error', sessionId: 's' })
    expect(voiced?.quip).toBeTruthy()
    expect(spoken).toEqual([voiced?.quip])
  })

  it('switches level immediately on the next event', () => {
    let level: ReactionSettings['level'] = 'action'
    let now = 10_000
    const live = createReactEngine({
      settings: () => ({
        ...DEFAULT_REACTION_SETTINGS,
        quietHours: [],
        quietCron: [],
        mutedSessions: [],
        globalCooldownMs: 0,
        kindCooldownMs: 0,
        level,
      }),
      now: () => now,
      random: () => 0,
    })
    expect(live.react({ kind: 'turn-start', sessionId: 's' })?.quip).toBeUndefined()
    level = 'bubble'
    now += 1
    const next = live.react({ kind: 'tool-error', sessionId: 's' })
    expect(next?.quip).toBeTruthy()
    expect(next?.level).toBe('bubble')
  })
})
