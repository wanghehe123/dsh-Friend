import { readFriendModelMap, type FriendModelMap } from '../model-map.ts'
import type { StageCue } from '../work-cue.ts'
import { isHiyoriExpression, type HiyoriExpression } from './hiyori-adapter.ts'
import { readStageTargetFps } from './stage-settings.ts'

export type PetPageConfig = Readonly<{
  modelUrl: string
  canvasId: string
  statusId: string
  initialExpression: HiyoriExpression
  targetFps: number
  embed: boolean
  map?: FriendModelMap
}>

const cues: Readonly<Record<HiyoriExpression, StageCue>> = {
  neutral: { expression: 'neutral', motionGroup: 'Idle', loop: true },
  happy: { expression: 'happy', motionGroup: 'Smile', loop: false },
  shy: { expression: 'shy', motionGroup: 'Embarrassed', loop: false },
  sad: { expression: 'sad', motionGroup: 'Sad', loop: false },
  surprised: { expression: 'surprised', motionGroup: 'Error', loop: false },
  sleepy: { expression: 'sleepy', motionGroup: 'Sleepy', loop: true },
  angry: { expression: 'angry', motionGroup: 'Angry', loop: false },
}

const HIYORI_MODEL_PREFIX = '/friend/assets/vendor/hiyori/'
const USER_MODEL_PATTERN = /^\/friend\/assets\/models\/[a-z0-9][a-z0-9._-]{0,63}\/.+\.model3\.json$/iu

/** Validate page-injected configuration; model assets must stay on the local DSH route. */
export function isAllowedPetModelUrl(modelUrl: string): boolean {
  if (modelUrl.includes('..') || modelUrl.includes('\\') || modelUrl.includes('\0')) return false
  if (modelUrl.startsWith(HIYORI_MODEL_PREFIX) && modelUrl.endsWith('.model3.json')) return true
  return USER_MODEL_PATTERN.test(modelUrl)
}

export function readPetPageConfig(value: unknown): PetPageConfig | undefined {
  if (!isRecord(value)) return undefined
  const { modelUrl, canvasId, statusId, initialExpression } = value
  if (
    typeof modelUrl !== 'string'
    || !isAllowedPetModelUrl(modelUrl)
    || typeof canvasId !== 'string'
    || canvasId.length === 0
    || typeof statusId !== 'string'
    || statusId.length === 0
    || typeof initialExpression !== 'string'
    || !isHiyoriExpression(initialExpression)
  ) {
    return undefined
  }
  const map = readFriendModelMap(value.map)
  return {
    modelUrl,
    canvasId,
    statusId,
    initialExpression,
    targetFps: readStageTargetFps(value),
    embed: value.embed === true,
    ...(map !== undefined ? { map } : {}),
  }
}

export function cueForExpression(expression: HiyoriExpression): StageCue {
  return cues[expression]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
