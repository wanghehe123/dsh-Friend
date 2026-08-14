import type { AsrEngine, AsrListenMode } from './engine.ts'
import {
  ASR_DEFAULT_MODE,
  ASR_DEFAULT_SILENCE_MS,
  createAsrModeMachine,
  type AsrModeEffect,
  type AsrModeEvent,
  type AsrModeMachine,
  type AsrModeState,
} from './modes.ts'

export type AsrTimerHandle = ReturnType<typeof setTimeout>

export type AsrSessionHooks = {
  onSend?: (text: string) => void
  onBargeIn?: () => void
  onPartial?: (text: string) => void
  onState?: (state: AsrModeState) => void
}

export type AsrSessionOptions = AsrSessionHooks & {
  engine: AsrEngine
  mode?: AsrListenMode
  bargeIn?: boolean
  silenceMs?: number
  autoSend?: boolean
  setTimeout?: (handler: () => void, ms: number) => AsrTimerHandle
  clearTimeout?: (handle: AsrTimerHandle) => void
}

export type AsrSession = {
  getState(): AsrModeState
  dispatch(event: AsrModeEvent): readonly AsrModeEffect[]
  setMode(mode: AsrListenMode): void
  setBargeIn(enabled: boolean): void
  setSilenceMs(ms: number): void
  setAutoSend(enabled: boolean): void
  getEngine(): AsrEngine
  /**
   * Hot-swap the recognition engine. Stops and unbinds the previous engine
   * before attaching the next. If the session is listening, the new engine
   * is started in the current mode.
   */
  setEngine(engine: AsrEngine): void
  /**
   * Inject a final transcript through the same `onSend` path the engine uses.
   * Used by the exposed client handle when a real utterance cannot be spoken.
   */
  submitFinal(text: string): void
  dispose(): void
}

/**
 * Interprets mode-machine effects against an AsrEngine and a silence timer.
 * The machine stays engine-agnostic; this binder is the only place that
 * calls `engine.start` / `engine.stop`.
 */
export function createAsrSession(options: AsrSessionOptions): AsrSession {
  const machine: AsrModeMachine = createAsrModeMachine({
    mode: options.mode ?? ASR_DEFAULT_MODE,
    bargeIn: options.bargeIn !== false,
    silenceMs: options.silenceMs ?? ASR_DEFAULT_SILENCE_MS,
  })
  const schedule = options.setTimeout ?? ((handler, ms) => setTimeout(handler, ms))
  const unschedule = options.clearTimeout ?? ((handle) => clearTimeout(handle))
  let engine = options.engine
  let silenceHandle: AsrTimerHandle | undefined
  let disposed = false
  let autoSend = options.autoSend !== false
  let lastEvent: AsrModeEvent['type'] | undefined
  let acceptTrailingFinal = false
  let sentOnThisStop = false

  const clearSilence = (): void => {
    if (silenceHandle === undefined) {
      return
    }
    unschedule(silenceHandle)
    silenceHandle = undefined
  }

  const sendText = (text: string, fromTrailing = false): void => {
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      return
    }
    acceptTrailingFinal = false
    if (fromTrailing) {
      sentOnThisStop = true
    }
    options.onSend?.(trimmed)
  }

  const bindEngineHandlers = (target: AsrEngine): void => {
    target.onPartial = (text) => {
      dispatch({ type: 'partial', text })
    }
    target.onFinal = (text) => {
      if (machine.getState().phase === 'listening') {
        dispatch({ type: 'final', text })
        return
      }
      // Endpoint (and some Web Speech implementations) only emit the
      // transcript after `stop()`. Hold mode has already left listening.
      if (acceptTrailingFinal && !disposed) {
        sendText(text, true)
      }
    }
    target.onError = (reason) => {
      acceptTrailingFinal = false
      dispatch({ type: 'engine-error', reason })
    }
  }

  const unbindEngineHandlers = (target: AsrEngine): void => {
    target.onPartial = undefined
    target.onFinal = undefined
    target.onError = undefined
  }

  const applyEffects = (effects: readonly AsrModeEffect[]): void => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'engine-start':
          acceptTrailingFinal = false
          sentOnThisStop = false
          engine.start(effect.mode)
          break
        case 'engine-stop':
          acceptTrailingFinal = true
          sentOnThisStop = false
          engine.stop()
          break
        case 'send':
          if (!autoSend && lastEvent === 'silence-timeout') {
            break
          }
          if (sentOnThisStop) {
            break
          }
          sendText(effect.text)
          break
        case 'barge-in':
          options.onBargeIn?.()
          break
        case 'arm-silence':
          clearSilence()
          silenceHandle = schedule(() => {
            silenceHandle = undefined
            if (!disposed) {
              dispatch({ type: 'silence-timeout' })
            }
          }, effect.ms)
          break
        case 'disarm-silence':
          clearSilence()
          break
      }
    }
  }

  const dispatch = (event: AsrModeEvent): readonly AsrModeEffect[] => {
    if (disposed) {
      return []
    }
    if (event.type === 'partial') {
      options.onPartial?.(event.text)
    }
    lastEvent = event.type
    const effects = machine.dispatch(event)
    applyEffects(effects)
    options.onState?.(machine.getState())
    return effects
  }

  bindEngineHandlers(engine)
  applyEffects(machine.dispatch({ type: 'boot' }))

  return {
    getState: () => machine.getState(),
    dispatch,
    setMode(mode) {
      dispatch({ type: 'set-mode', mode })
    },
    setBargeIn(enabled) {
      dispatch({ type: 'set-barge-in', enabled })
    },
    setSilenceMs(ms) {
      dispatch({ type: 'set-silence-ms', ms })
    },
    setAutoSend(enabled) {
      autoSend = enabled
    },
    getEngine() {
      return engine
    },
    submitFinal(text) {
      sendText(text)
    },
    setEngine(next) {
      if (disposed || next === engine) {
        return
      }
      const listening = machine.getState().phase === 'listening'
      const mode = machine.getState().mode
      unbindEngineHandlers(engine)
      try {
        engine.stop()
      } catch {
        // a failing stop must not leave the new engine unbound
      }
      engine = next
      bindEngineHandlers(engine)
      if (listening) {
        engine.start(mode)
      }
    },
    dispose() {
      if (disposed) {
        return
      }
      acceptTrailingFinal = false
      clearSilence()
      applyEffects(machine.dispatch({ type: 'reset' }))
      disposed = true
      unbindEngineHandlers(engine)
    },
  }
}
