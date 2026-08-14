/**
 * Platform-neutral stage tag protocol. Safe for Node host and TTS prep.
 * Must not import `node:`, browser globals, Live2D, or the pet page.
 */
export {
  MAX_STAGE_TAG_LENGTH,
  STAGE_TAG_KINDS,
  StreamingTagParser,
  classifyClosedStageTag,
  concatTagParseDeltas,
  isKnownStageTagValue,
  parseStageTags,
  type StageTagEvent,
  type StageTagKind,
  type TagParseDelta,
} from './tag-parser.ts'

export {
  HIYORI_EXPRESSIONS,
  STAGE_CUE_NAMES,
  STAGE_MOTION_GROUPS,
  isHiyoriExpression,
  isStageCueName,
  isStageMotionGroup,
  type HiyoriExpression,
  type StageCueName,
  type StageMotionGroup,
} from './tag-vocab.ts'
