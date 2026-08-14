/**
 * ASR engine seam. Concrete engines (Web Speech now, endpoint later)
 * implement this; the mode machine never imports an engine module.
 */

export type AsrListenMode = 'hold' | 'toggle' | 'auto'

export type AsrEngineId = 'webspeech' | 'endpoint'

export type AsrEnginePreference = 'auto' | AsrEngineId

export type AsrUnavailableCode =
  | 'missing-speech-recognition'
  | 'safari'
  | 'desktop-shell'
  | 'missing-media-recorder'

export interface AsrEngineCapabilities {
  available: boolean
  engineId: AsrEngineId
  /** Human-readable reason when `available` is false. */
  reason?: string
  reasonCode?: AsrUnavailableCode
  interimResults: boolean
  continuous: boolean
}

export type AsrTranscriptHandler = (text: string) => void
export type AsrErrorHandler = (reason: string) => void

/**
 * Recognition engine contract (W-M3-1).
 *
 * `onPartial` / `onFinal` / `onError` are assignable callbacks so a session
 * can subscribe without the engine knowing about modes.
 */
export interface AsrEngine {
  start(mode: AsrListenMode): void
  stop(): void
  onPartial: AsrTranscriptHandler | undefined
  onFinal: AsrTranscriptHandler | undefined
  onError: AsrErrorHandler | undefined
  capabilities(): AsrEngineCapabilities
}

/** First available engine in `webspeech → endpoint` order (spec auto-select). */
export function selectAsrEngine(engines: readonly AsrEngine[]): AsrEngine | undefined {
  return engines.find((engine) => engine.capabilities().available)
}

export type AsrEngineChoice = {
  engine: AsrEngine | undefined
  engineId: AsrEngineId | undefined
  reason?: string
}

/**
 * Preference `auto` = first available in webspeech → endpoint order.
 * An explicit preference is honored only when that engine reports available.
 */
export function resolveAsrEngine(
  preference: AsrEnginePreference,
  engines: readonly AsrEngine[],
): AsrEngineChoice {
  const byId = (id: AsrEngineId): AsrEngine | undefined => {
    return engines.find((engine) => engine.capabilities().engineId === id)
  }

  if (preference !== 'auto') {
    const chosen = byId(preference)
    if (chosen?.capabilities().available === true) {
      return { engine: chosen, engineId: preference }
    }
    const fallback = selectAsrEngine(engines)
    return {
      engine: fallback,
      engineId: fallback?.capabilities().engineId,
      reason: chosen?.capabilities().reason ?? `${preference} unavailable`,
    }
  }

  const auto = selectAsrEngine(engines)
  if (auto !== undefined) {
    return { engine: auto, engineId: auto.capabilities().engineId }
  }
  return {
    engine: undefined,
    engineId: undefined,
    reason: '当前环境没有可用的语音识别引擎，请配置自定义 endpoint 或改用 Chromium',
  }
}
