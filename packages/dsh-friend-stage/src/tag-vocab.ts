/** The public expression vocabulary exposed by the dsh-Friend stage. */
export const HIYORI_EXPRESSIONS = [
  'neutral',
  'happy',
  'shy',
  'sad',
  'surprised',
  'sleepy',
  'angry',
] as const

export type HiyoriExpression = (typeof HIYORI_EXPRESSIONS)[number]

export function isHiyoriExpression(value: string): value is HiyoriExpression {
  return (HIYORI_EXPRESSIONS as readonly string[]).includes(value)
}

export {
  STAGE_CUE_NAMES,
  STAGE_MOTION_GROUPS,
  isStageCueName,
  isStageMotionGroup,
  type StageCueName,
  type StageMotionGroup,
} from './work-cue.ts'
