import type { AsrListenMode } from './engine.ts'

export type AsrPhase = 'idle' | 'listening'

export const ASR_DEFAULT_SILENCE_MS = 1200
export const ASR_DEFAULT_MODE: AsrListenMode = 'hold'

export type AsrModeState = {
  phase: AsrPhase
  mode: AsrListenMode
  /** Live transcript waiting to be sent (committed + latest partial). */
  draft: string
  /** Concatenated final segments in the current listening session. */
  committed: string
  /** Physical hotkey currently down. */
  held: boolean
  lastError: string | undefined
  bargeIn: boolean
}

export type AsrModeEvent =
  | { type: 'hotkey-down'; repeat?: boolean }
  | { type: 'hotkey-up' }
  | { type: 'set-mode'; mode: AsrListenMode }
  | { type: 'set-barge-in'; enabled: boolean }
  | { type: 'set-silence-ms'; ms: number }
  | { type: 'partial'; text: string }
  | { type: 'partial-reset' }
  | { type: 'final'; text: string }
  | { type: 'engine-error'; reason: string }
  | { type: 'silence-timeout' }
  | { type: 'boot' }
  | { type: 'reset' }

export type AsrModeEffect =
  | { type: 'engine-start'; mode: AsrListenMode }
  | { type: 'engine-stop' }
  | { type: 'send'; text: string }
  | { type: 'barge-in' }
  | { type: 'arm-silence'; ms: number }
  | { type: 'disarm-silence' }

export type AsrModeConfig = {
  mode?: AsrListenMode
  bargeIn?: boolean
  silenceMs?: number
}

export type AsrModeStep = {
  state: AsrModeState
  effects: readonly AsrModeEffect[]
}

function initialState(config: AsrModeConfig): AsrModeState {
  return {
    phase: 'idle',
    mode: config.mode ?? ASR_DEFAULT_MODE,
    draft: '',
    committed: '',
    held: false,
    lastError: undefined,
    bargeIn: config.bargeIn !== false,
  }
}

function trimText(text: string): string {
  return text.trim()
}

function sendIfDraft(state: AsrModeState, effects: AsrModeEffect[]): void {
  const text = trimText(state.draft)
  if (text.length === 0) {
    return
  }
  effects.push({ type: 'send', text })
}

function enterListening(state: AsrModeState, silenceMs: number, effects: AsrModeEffect[]): AsrModeState {
  if (state.bargeIn) {
    effects.push({ type: 'barge-in' })
  }
  effects.push({ type: 'engine-start', mode: state.mode })
  if (state.mode === 'auto') {
    effects.push({ type: 'arm-silence', ms: silenceMs })
  }
  return {
    ...state,
    phase: 'listening',
    draft: '',
    committed: '',
    lastError: undefined,
  }
}

function leaveListening(
  state: AsrModeState,
  effects: AsrModeEffect[],
  send: boolean,
): AsrModeState {
  if (state.phase === 'listening') {
    effects.push({ type: 'engine-stop' })
  }
  effects.push({ type: 'disarm-silence' })
  if (send) {
    sendIfDraft(state, effects)
  }
  return {
    ...state,
    phase: 'idle',
    draft: '',
    committed: '',
  }
}

function onSpeech(state: AsrModeState, silenceMs: number, effects: AsrModeEffect[]): void {
  if (state.phase !== 'listening' || state.mode !== 'auto') {
    return
  }
  if (state.bargeIn) {
    effects.push({ type: 'barge-in' })
  }
  effects.push({ type: 'arm-silence', ms: silenceMs })
}

/**
 * Pure mode reducer. No engine, no timers, no DOM.
 * Session runtime interprets `effects` (start/stop engine, arm silence, send, barge-in).
 */
export function reduceAsrMode(
  state: AsrModeState,
  event: AsrModeEvent,
  config: AsrModeConfig = {},
): AsrModeStep {
  const silenceMs = config.silenceMs ?? ASR_DEFAULT_SILENCE_MS
  const effects: AsrModeEffect[] = []

  switch (event.type) {
    case 'set-barge-in':
      return { state: { ...state, bargeIn: event.enabled }, effects }

    case 'set-silence-ms':
      if (state.phase === 'listening' && state.mode === 'auto') {
        effects.push({ type: 'arm-silence', ms: silenceMs })
      }
      return { state, effects }

    case 'reset':
      return { state: leaveListening({ ...state, held: false }, effects, false), effects }

    case 'boot':
      if (state.mode === 'auto' && state.phase === 'idle') {
        return { state: enterListening(state, silenceMs, effects), effects }
      }
      return { state, effects }

    case 'hotkey-down': {
      if (event.repeat === true) {
        return { state, effects }
      }
      const held = { ...state, held: true }
      if (held.mode === 'auto') {
        if (held.phase === 'idle') {
          return { state: enterListening(held, silenceMs, effects), effects }
        }
        if (held.bargeIn) {
          effects.push({ type: 'barge-in' })
        }
        effects.push({ type: 'engine-start', mode: 'auto' })
        return { state: held, effects }
      }
      if (held.mode === 'hold') {
        if (held.phase === 'idle') {
          return { state: enterListening(held, silenceMs, effects), effects }
        }
        return { state: held, effects }
      }
      // toggle: each non-repeat keydown flips listening
      if (held.phase === 'idle') {
        return { state: enterListening(held, silenceMs, effects), effects }
      }
      return { state: leaveListening(held, effects, true), effects }
    }

    case 'hotkey-up': {
      const released = { ...state, held: false }
      if (released.mode === 'hold' && released.phase === 'listening') {
        return { state: leaveListening(released, effects, true), effects }
      }
      return { state: released, effects }
    }

    case 'set-mode': {
      const nextMode = event.mode
      const prevMode = state.mode
      if (nextMode === prevMode) {
        return { state, effects }
      }
      let next: AsrModeState = { ...state, mode: nextMode }

      if (nextMode === 'auto') {
        if (next.phase === 'idle') {
          next = enterListening(next, silenceMs, effects)
        } else {
          effects.push({ type: 'engine-start', mode: 'auto' })
          effects.push({ type: 'arm-silence', ms: silenceMs })
        }
        return { state: next, effects }
      }

      if (prevMode === 'auto' && next.phase === 'listening' && !next.held) {
        next = leaveListening(next, effects, true)
        return { state: next, effects }
      }

      if (prevMode === 'auto') {
        effects.push({ type: 'disarm-silence' })
      }
      if (next.phase === 'listening') {
        effects.push({ type: 'engine-start', mode: nextMode })
      }
      return { state: next, effects }
    }

    case 'partial': {
      if (state.phase !== 'listening') {
        return { state, effects }
      }
      const next = { ...state, draft: state.committed + event.text }
      onSpeech(next, silenceMs, effects)
      return { state: next, effects }
    }

    case 'partial-reset': {
      if (state.phase !== 'listening') {
        return { state, effects }
      }
      return { state: { ...state, draft: state.committed }, effects }
    }

    case 'final': {
      if (state.phase !== 'listening') {
        return { state, effects }
      }
      const committed = state.committed + event.text
      const next = { ...state, committed, draft: committed }
      onSpeech(next, silenceMs, effects)
      return { state: next, effects }
    }

    case 'silence-timeout': {
      if (state.phase !== 'listening' || state.mode !== 'auto') {
        return { state, effects }
      }
      sendIfDraft(state, effects)
      return {
        state: { ...state, draft: '', committed: '' },
        effects,
      }
    }

    case 'engine-error': {
      const failed = { ...state, lastError: event.reason }
      return { state: leaveListening(failed, effects, false), effects }
    }
  }
}

export type AsrModeMachine = {
  getState(): AsrModeState
  dispatch(event: AsrModeEvent): readonly AsrModeEffect[]
}

export function createAsrModeMachine(config: AsrModeConfig = {}): AsrModeMachine {
  let state = initialState(config)
  let silenceMs = config.silenceMs ?? ASR_DEFAULT_SILENCE_MS
  let live: AsrModeConfig = { ...config, silenceMs, bargeIn: config.bargeIn !== false }

  return {
    getState() {
      return state
    },
    dispatch(event) {
      if (event.type === 'set-silence-ms') {
        if (event.ms === silenceMs) {
          return []
        }
        silenceMs = event.ms
        live = { ...live, silenceMs }
      }
      if (event.type === 'set-barge-in') {
        live = { ...live, bargeIn: event.enabled }
      }
      const stepped = reduceAsrMode(state, event, live)
      state = stepped.state
      return stepped.effects
    },
  }
}
