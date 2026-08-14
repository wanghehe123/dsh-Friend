import { LIVE2D_TARGET_FPS } from './performance.ts'

/** Field inside the friend-stage settings document. */
export const STAGE_TARGET_FPS_FIELD = 'targetFps' as const
export const STAGE_FLOAT_LEFT_FIELD = 'floatLeft' as const
export const STAGE_FLOAT_TOP_FIELD = 'floatTop' as const
export const STAGE_FLOAT_WIDTH_FIELD = 'floatWidth' as const
export const STAGE_FLOAT_HEIGHT_FIELD = 'floatHeight' as const
export const STAGE_FLOAT_HIDDEN_FIELD = 'floatHidden' as const
export const STAGE_FLOAT_MUTED_FIELD = 'floatMuted' as const
export const STAGE_BUBBLE_TIMEOUT_MS_FIELD = 'bubbleTimeoutMs' as const

export const STAGE_TARGET_FPS_MIN = 1
export const STAGE_TARGET_FPS_MAX = 120

export const DEFAULT_FLOAT_WIDTH = 280
export const DEFAULT_FLOAT_HEIGHT = 360
export const MIN_FLOAT_WIDTH = 160
export const MIN_FLOAT_HEIGHT = 200
export const DEFAULT_BUBBLE_TIMEOUT_MS = 8_000

export type StageUiSettings = Readonly<{
  targetFps: number
  floatLeft: number | undefined
  floatTop: number | undefined
  floatWidth: number
  floatHeight: number
  floatHidden: boolean
  floatMuted: boolean
  bubbleTimeoutMs: number
}>

export function readStageTargetFps(section: unknown): number {
  return readStageUiSettings(section).targetFps
}

export function readStageUiSettings(section: unknown): StageUiSettings {
  const record = asRecord(section)
  return {
    targetFps: clampInt(record[STAGE_TARGET_FPS_FIELD], LIVE2D_TARGET_FPS, STAGE_TARGET_FPS_MIN, STAGE_TARGET_FPS_MAX),
    floatLeft: optionalNumber(record[STAGE_FLOAT_LEFT_FIELD]),
    floatTop: optionalNumber(record[STAGE_FLOAT_TOP_FIELD]),
    floatWidth: clampInt(record[STAGE_FLOAT_WIDTH_FIELD], DEFAULT_FLOAT_WIDTH, MIN_FLOAT_WIDTH, 1200),
    floatHeight: clampInt(record[STAGE_FLOAT_HEIGHT_FIELD], DEFAULT_FLOAT_HEIGHT, MIN_FLOAT_HEIGHT, 1600),
    floatHidden: record[STAGE_FLOAT_HIDDEN_FIELD] === true,
    floatMuted: record[STAGE_FLOAT_MUTED_FIELD] === true,
    bubbleTimeoutMs: clampInt(record[STAGE_BUBBLE_TIMEOUT_MS_FIELD], DEFAULT_BUBBLE_TIMEOUT_MS, 1_000, 120_000),
  }
}

function asRecord(section: unknown): Record<string, unknown> {
  if (typeof section !== 'object' || section === null) return {}
  return section as Record<string, unknown>
}

function optionalNumber(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  return raw
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, Math.round(raw)))
}
