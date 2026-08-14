import type { HiyoriExpression } from '../tag-vocab.ts'
import type { StageCue } from '../work-cue.ts'

export {
  HIYORI_EXPRESSIONS,
  isHiyoriExpression,
  type HiyoriExpression,
} from '../tag-vocab.ts'

export type HiyoriParameterPreset = Readonly<Record<string, number>>
export type HiyoriMotion = Readonly<{ group: string; index: number }>

/*
 * Hiyori FREE ships no .exp3.json assets. These are real parameter IDs from
 * hiyori_free_t08.cdi3.json, applied after Cubism's motion update so the
 * seven portable expressions remain available without modifying official art.
 */
const expressionPresets: Readonly<Record<HiyoriExpression, HiyoriParameterPreset>> = {
  neutral: {
    ParamCheek: 0,
    ParamEyeLOpen: 1,
    ParamEyeLSmile: 0,
    ParamEyeROpen: 1,
    ParamEyeRSmile: 0,
    ParamBrowLForm: 0,
    ParamBrowRForm: 0,
    ParamMouthForm: 0,
    ParamMouthOpenY: 0,
  },
  happy: {
    ParamCheek: 0.8,
    ParamEyeLOpen: 0.9,
    ParamEyeLSmile: 1,
    ParamEyeROpen: 0.9,
    ParamEyeRSmile: 1,
    ParamBrowLForm: 0.2,
    ParamBrowRForm: 0.2,
    ParamMouthForm: 1,
    ParamMouthOpenY: 0.15,
  },
  shy: {
    ParamCheek: 1,
    ParamEyeLOpen: 0.7,
    ParamEyeLSmile: 0.25,
    ParamEyeROpen: 0.7,
    ParamEyeRSmile: 0.25,
    ParamBrowLForm: -0.3,
    ParamBrowRForm: -0.3,
    ParamMouthForm: 0.4,
    ParamMouthOpenY: 0.05,
    ParamAngleZ: -8,
  },
  sad: {
    ParamCheek: 0,
    ParamEyeLOpen: 0.7,
    ParamEyeLSmile: 0,
    ParamEyeROpen: 0.7,
    ParamEyeRSmile: 0,
    ParamBrowLForm: -1,
    ParamBrowRForm: -1,
    ParamMouthForm: -0.8,
    ParamMouthOpenY: 0,
    ParamAngleY: -6,
  },
  surprised: {
    ParamCheek: 0.2,
    ParamEyeLOpen: 1,
    ParamEyeLSmile: 0,
    ParamEyeROpen: 1,
    ParamEyeRSmile: 0,
    ParamBrowLForm: 0.7,
    ParamBrowRForm: 0.7,
    ParamMouthForm: 0,
    ParamMouthOpenY: 0.85,
  },
  sleepy: {
    ParamCheek: 0,
    ParamEyeLOpen: 0.25,
    ParamEyeLSmile: 0,
    ParamEyeROpen: 0.25,
    ParamEyeRSmile: 0,
    ParamBrowLForm: -0.25,
    ParamBrowRForm: -0.25,
    ParamMouthForm: 0.1,
    ParamMouthOpenY: 0,
    ParamAngleY: -8,
  },
  angry: {
    ParamCheek: 0.45,
    ParamEyeLOpen: 0.85,
    ParamEyeLSmile: 0,
    ParamEyeROpen: 0.85,
    ParamEyeRSmile: 0,
    ParamBrowLForm: 1,
    ParamBrowRForm: 1,
    ParamMouthForm: -1,
    ParamMouthOpenY: 0.15,
    ParamAngleZ: 6,
  },
}

/**
 * These names are exactly the groups declared by Hiyori FREE's model3.json.
 * The visual meanings are an adapter choice; a commissioned model can supply
 * its own adapter without changing the stage's public vocabulary.
 */
const motionByCue: Readonly<Record<StageCue['motionGroup'], HiyoriMotion>> = {
  Idle: { group: 'Idle', index: 0 },
  Thinking: { group: 'Idle', index: 1 },
  Celebrate: { group: 'Tap', index: 0 },
  Smile: { group: 'Tap', index: 0 },
  Embarrassed: { group: 'FlickDown', index: 0 },
  Sad: { group: 'Flick', index: 0 },
  Angry: { group: 'Flick@Body', index: 0 },
  Error: { group: 'FlickDown', index: 0 },
  Sleepy: { group: 'Idle', index: 2 },
}

export function getHiyoriExpressionPreset(expression: HiyoriExpression): HiyoriParameterPreset {
  return expressionPresets[expression]
}

export function resolveHiyoriMotion(motionGroup: StageCue['motionGroup']): HiyoriMotion {
  return motionByCue[motionGroup]
}
