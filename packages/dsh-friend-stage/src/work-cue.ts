/** Portable motion groups. Adapters map these onto a model's real motion assets. */
export const STAGE_MOTION_GROUPS = [
  'Idle',
  'Thinking',
  'Celebrate',
  'Smile',
  'Embarrassed',
  'Sad',
  'Angry',
  'Error',
  'Sleepy',
] as const

export type StageMotionGroup = (typeof STAGE_MOTION_GROUPS)[number]

/** Named performances accepted by `[cue:*]` / `play_cue`. */
export const STAGE_CUE_NAMES = [
  'idle',
  'thinking',
  'success',
  'error',
  'happy',
  'shy',
  'sad',
  'angry',
  'sleepy',
] as const

export type StageCueName = (typeof STAGE_CUE_NAMES)[number]

/** A normalized work signal, deliberately independent of DSH's evolving event wire. */
export type WorkSignal = {
  kind: StageCueName
}

/** The portable stage instruction consumed by the Live2D mapping layer in M4. */
export type StageCue = {
  expression: 'neutral' | 'happy' | 'shy' | 'sad' | 'angry' | 'surprised' | 'sleepy'
  motionGroup: StageMotionGroup
  loop: boolean
}

export function isStageMotionGroup(value: string): value is StageMotionGroup {
  return (STAGE_MOTION_GROUPS as readonly string[]).includes(value)
}

export function isStageCueName(value: string): value is StageCueName {
  return (STAGE_CUE_NAMES as readonly string[]).includes(value)
}

/**
 * Map a normalized work state to the model-agnostic stage vocabulary.
 *
 * The later model adapter maps `expression` and `motionGroup` to a model's
 * actual `.exp3.json` and `.motion3.json` asset names. Keeping that mapping
 * separate means Hiyori and an eventually licensed original mascot can share
 * this behavior unchanged.
 */
export function resolveWorkCue(signal: WorkSignal): StageCue {
  switch (signal.kind) {
    case 'idle':
      return {
        expression: 'neutral',
        motionGroup: 'Idle',
        loop: true,
      }
    case 'thinking':
      return {
        expression: 'neutral',
        motionGroup: 'Thinking',
        loop: true,
      }
    case 'success':
      return {
        expression: 'happy',
        motionGroup: 'Celebrate',
        loop: false,
      }
    case 'happy':
      return {
        expression: 'happy',
        motionGroup: 'Smile',
        loop: false,
      }
    case 'shy':
      return {
        expression: 'shy',
        motionGroup: 'Embarrassed',
        loop: false,
      }
    case 'sad':
      return {
        expression: 'sad',
        motionGroup: 'Sad',
        loop: false,
      }
    case 'angry':
      return {
        expression: 'angry',
        motionGroup: 'Angry',
        loop: false,
      }
    case 'sleepy':
      return {
        expression: 'sleepy',
        motionGroup: 'Sleepy',
        loop: true,
      }
    case 'error':
      return {
        expression: 'surprised',
        motionGroup: 'Error',
        loop: false,
      }
  }

  throw new Error(`Unsupported dsh-Friend stage signal: ${String(signal.kind)}`)
}
