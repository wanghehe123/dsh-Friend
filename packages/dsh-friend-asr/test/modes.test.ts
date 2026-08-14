import { describe, expect, it } from 'vitest'

import {
  createAsrModeMachine,
  reduceAsrMode,
  type AsrModeEffect,
  type AsrModeEvent,
  type AsrModeState,
} from '../src/modes.ts'

function idle(overrides: Partial<AsrModeState> = {}): AsrModeState {
  return {
    phase: 'idle',
    mode: 'hold',
    draft: '',
    committed: '',
    held: false,
    lastError: undefined,
    bargeIn: true,
    ...overrides,
  }
}

function effectsOf(events: readonly AsrModeEvent[], config?: { mode?: 'hold' | 'toggle' | 'auto'; bargeIn?: boolean }): {
  state: AsrModeState
  effects: AsrModeEffect[]
} {
  const machine = createAsrModeMachine(config)
  const effects: AsrModeEffect[] = []
  for (const event of events) {
    effects.push(...machine.dispatch(event))
  }
  return { state: machine.getState(), effects }
}

function types(effects: readonly AsrModeEffect[]): string[] {
  return effects.map((effect) => effect.type)
}

describe('hold (push-to-talk) mode', () => {
  it('starts on keydown, sends on keyup, and barges in once', () => {
    const { state, effects } = effectsOf([
      { type: 'hotkey-down' },
      { type: 'partial', text: '今天' },
      { type: 'final', text: '今天天气不错' },
      { type: 'hotkey-up' },
    ])
    expect(types(effects)).toEqual(['barge-in', 'engine-start', 'engine-stop', 'disarm-silence', 'send'])
    expect(effects).toContainEqual({ type: 'engine-start', mode: 'hold' })
    expect(effects).toContainEqual({ type: 'send', text: '今天天气不错' })
    expect(state.phase).toBe('idle')
    expect(state.draft).toBe('')
  })

  it('does not send an empty utterance on keyup', () => {
    const { effects } = effectsOf([{ type: 'hotkey-down' }, { type: 'hotkey-up' }])
    expect(effects.some((effect) => effect.type === 'send')).toBe(false)
  })

  it('ignores key-repeat while held, then a rapid second press is a new utterance', () => {
    const { effects } = effectsOf([
      { type: 'hotkey-down' },
      { type: 'hotkey-down', repeat: true },
      { type: 'final', text: '一' },
      { type: 'hotkey-up' },
      { type: 'hotkey-down' },
      { type: 'final', text: '二' },
      { type: 'hotkey-up' },
    ])
    const starts = effects.filter((effect) => effect.type === 'engine-start')
    const sends = effects.filter((effect) => effect.type === 'send')
    expect(starts).toHaveLength(2)
    expect(sends).toEqual([
      { type: 'send', text: '一' },
      { type: 'send', text: '二' },
    ])
  })
})

describe('toggle mode', () => {
  it('starts on the first keydown and sends on the second; keyup does not stop', () => {
    const { state, effects } = effectsOf([
      { type: 'hotkey-down' },
      { type: 'hotkey-up' },
      { type: 'final', text: '切换一句' },
      { type: 'hotkey-down' },
    ], { mode: 'toggle' })
    expect(effects).toContainEqual({ type: 'engine-start', mode: 'toggle' })
    expect(effects).toContainEqual({ type: 'send', text: '切换一句' })
    expect(state.phase).toBe('idle')
  })

  it('treats a rapid double-press as start then stop', () => {
    const { state, effects } = effectsOf([
      { type: 'hotkey-down' },
      { type: 'hotkey-down' },
    ], { mode: 'toggle' })
    expect(types(effects).filter((type) => type === 'engine-start')).toHaveLength(1)
    expect(types(effects).filter((type) => type === 'engine-stop')).toHaveLength(1)
    expect(state.phase).toBe('idle')
  })
})

describe('auto-listen mode', () => {
  it('starts on boot/set-mode and sends after silence-timeout, then keeps listening', () => {
    const { state, effects } = effectsOf([
      { type: 'set-mode', mode: 'auto' },
      { type: 'partial', text: '你好' },
      { type: 'final', text: '你好啊' },
      { type: 'silence-timeout' },
      { type: 'partial', text: '下一句' },
    ])
    expect(effects).toContainEqual({ type: 'engine-start', mode: 'auto' })
    expect(effects).toContainEqual({ type: 'arm-silence', ms: 1200 })
    expect(effects).toContainEqual({ type: 'send', text: '你好啊' })
    expect(state.phase).toBe('listening')
    expect(state.draft).toBe('下一句')
  })

  it('does not finalize while speech keeps arriving (silence timer is re-armed)', () => {
    const { effects } = effectsOf([
      { type: 'set-mode', mode: 'auto' },
      { type: 'partial', text: '今' },
      { type: 'partial', text: '今天' },
      { type: 'final', text: '今天天气不错' },
    ])
    const arms = effects.filter((effect) => effect.type === 'arm-silence')
    expect(arms.length).toBeGreaterThanOrEqual(3)
    expect(effects.some((effect) => effect.type === 'send')).toBe(false)
  })

  it('does not send an empty silence timeout', () => {
    const { effects } = effectsOf([
      { type: 'set-mode', mode: 'auto' },
      { type: 'silence-timeout' },
    ])
    expect(effects.some((effect) => effect.type === 'send')).toBe(false)
  })
})

describe('mode switch while speaking', () => {
  it('hold → toggle: keyup no longer sends; the next keydown does', () => {
    const { state, effects } = effectsOf([
      { type: 'hotkey-down' },
      { type: 'final', text: '还在说' },
      { type: 'set-mode', mode: 'toggle' },
      { type: 'hotkey-up' },
      { type: 'hotkey-down' },
    ])
    expect(state.phase).toBe('idle')
    expect(effects).toContainEqual({ type: 'send', text: '还在说' })
    const sends = effects.filter((effect) => effect.type === 'send')
    expect(sends).toHaveLength(1)
  })

  it('hold → auto: keyup does not send; silence-timeout does', () => {
    const { state, effects } = effectsOf([
      { type: 'hotkey-down' },
      { type: 'final', text: '切到自动' },
      { type: 'set-mode', mode: 'auto' },
      { type: 'hotkey-up' },
      { type: 'silence-timeout' },
    ])
    expect(state.phase).toBe('listening')
    expect(effects).toContainEqual({ type: 'engine-start', mode: 'auto' })
    expect(effects).toContainEqual({ type: 'send', text: '切到自动' })
  })

  it('auto → hold without a held key stops and sends leftover', () => {
    const { state, effects } = effectsOf([
      { type: 'set-mode', mode: 'auto' },
      { type: 'final', text: '离开自动' },
      { type: 'set-mode', mode: 'hold' },
    ])
    expect(state.phase).toBe('idle')
    expect(state.mode).toBe('hold')
    expect(effects).toContainEqual({ type: 'send', text: '离开自动' })
  })
})

describe('engine error mid-utterance', () => {
  it('stops without sending and records the reason', () => {
    const { state, effects } = effectsOf([
      { type: 'hotkey-down' },
      { type: 'partial', text: '半句' },
      { type: 'engine-error', reason: 'not-allowed' },
    ])
    expect(state.phase).toBe('idle')
    expect(state.lastError).toBe('not-allowed')
    expect(state.draft).toBe('')
    expect(effects).toContainEqual({ type: 'engine-stop' })
    expect(effects.some((effect) => effect.type === 'send')).toBe(false)
  })

  it('recovers: a later hold cycle can send', () => {
    const { state, effects } = effectsOf([
      { type: 'hotkey-down' },
      { type: 'engine-error', reason: 'network' },
      { type: 'hotkey-up' },
      { type: 'hotkey-down' },
      { type: 'final', text: '恢复了' },
      { type: 'hotkey-up' },
    ])
    expect(state.lastError).toBeUndefined()
    expect(effects).toContainEqual({ type: 'send', text: '恢复了' })
  })
})

describe('barge-in', () => {
  it('fires once per listening session when enabled, and never when disabled', () => {
    const enabled = effectsOf([
      { type: 'hotkey-down' },
      { type: 'partial', text: 'x' },
      { type: 'hotkey-up' },
      { type: 'hotkey-down' },
    ])
    expect(enabled.effects.filter((effect) => effect.type === 'barge-in')).toHaveLength(2)

    const disabled = effectsOf([{ type: 'hotkey-down' }], { bargeIn: false })
    expect(disabled.effects.some((effect) => effect.type === 'barge-in')).toBe(false)
  })
})

describe('reduceAsrMode is a pure function', () => {
  it('does not mutate the input state object', () => {
    const state = idle()
    const before = structuredClone(state)
    reduceAsrMode(state, { type: 'hotkey-down' })
    expect(state).toEqual(before)
  })
})
