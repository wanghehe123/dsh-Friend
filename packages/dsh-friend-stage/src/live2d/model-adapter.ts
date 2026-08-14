import type { FriendModelMap } from '../model-map.ts'
import type { HiyoriExpression } from '../tag-vocab.ts'
import type { StageMotionGroup } from '../work-cue.ts'
import { resolveHiyoriMotion, type HiyoriMotion } from './hiyori-adapter.ts'

export function expressionNameFromMapFile(file: string): string {
  const base = file.replace(/\\/gu, '/').split('/').pop() ?? file
  return base.replace(/\.exp3\.json$/iu, '')
}

export function mappedExpressionFile(
  map: FriendModelMap,
  expression: HiyoriExpression,
): string | undefined {
  const file = map.expressions[expression]
  return typeof file === 'string' && file.length > 0 ? file : undefined
}

export function shouldApplyHiyoriPresets(map: FriendModelMap): boolean {
  return Object.values(map.expressions).every((file) => file === undefined || file.length === 0)
}

export function resolveMappedMotion(map: FriendModelMap, motionGroup: StageMotionGroup): HiyoriMotion {
  if (hasMotionGroup(map, motionGroup)) {
    return { group: motionGroup, index: 0 }
  }
  const hiyori = resolveHiyoriMotion(motionGroup)
  if (hasMotionGroup(map, hiyori.group) && (map.motions[hiyori.group]?.length ?? 0) > hiyori.index) {
    return hiyori
  }
  if (hasMotionGroup(map, hiyori.group)) {
    return { group: hiyori.group, index: 0 }
  }
  const first = Object.keys(map.motions).find((group) => hasMotionGroup(map, group))
  if (first !== undefined) {
    return { group: first, index: 0 }
  }
  return { group: 'Idle', index: 0 }
}

function hasMotionGroup(map: FriendModelMap, group: string): boolean {
  return (map.motions[group]?.length ?? 0) > 0
}
