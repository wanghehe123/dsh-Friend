import { cueForExpression } from './live2d/pet-config.ts'
import { isHiyoriExpression, type HiyoriExpression } from './live2d/hiyori-adapter.ts'
import {
  isStageCueName,
  isStageMotionGroup,
  resolveWorkCue,
  type StageCueName,
  type StageMotionGroup,
} from './work-cue.ts'
import type { StageTagEvent } from './tag-parser.ts'

export type PerformanceAction = 'expr' | 'motion' | 'cue'

/**
 * Full current performance, never a delta. `EventSource` reconnects without
 * replaying missed frames, so every SSE push and every GET snapshot must be
 * enough to restore the pet page on its own.
 */
export type PerformanceSnapshot = Readonly<{
  expression: HiyoriExpression
  motionGroup: StageMotionGroup
  cue: string
  lastAction: PerformanceAction
  seq: number
}>

export const IDLE_PERFORMANCE: PerformanceSnapshot = {
  expression: 'neutral',
  motionGroup: 'Idle',
  cue: '',
  lastAction: 'expr',
  seq: 0,
}

export type PerformanceListener = (snapshot: PerformanceSnapshot) => void

export type PerformanceTracker = {
  snapshot(): PerformanceSnapshot
  setExpression(expression: HiyoriExpression): PerformanceSnapshot
  setMotion(group: StageMotionGroup): PerformanceSnapshot
  playCue(name: StageCueName): PerformanceSnapshot
  subscribe(listener: PerformanceListener): () => void
}

export function createPerformanceTracker(
  initial: PerformanceSnapshot = IDLE_PERFORMANCE,
): PerformanceTracker {
  let current = initial
  const listeners = new Set<PerformanceListener>()

  const commit = (next: Omit<PerformanceSnapshot, 'seq'>): PerformanceSnapshot => {
    current = { ...next, seq: current.seq + 1 }
    for (const listener of listeners) listener(current)
    return current
  }

  return {
    snapshot(): PerformanceSnapshot {
      return current
    },
    setExpression(expression) {
      const cue = cueForExpression(expression)
      return commit({
        expression,
        motionGroup: cue.motionGroup,
        cue: current.cue,
        lastAction: 'expr',
      })
    },
    setMotion(group) {
      return commit({
        expression: current.expression,
        motionGroup: group,
        cue: current.cue,
        lastAction: 'motion',
      })
    },
    playCue(name) {
      const cue = resolveWorkCue({ kind: name })
      return commit({
        expression: cue.expression,
        motionGroup: cue.motionGroup,
        cue: name,
        lastAction: 'cue',
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

let shared = createPerformanceTracker()

/** Process-wide seam so work reactions can play cues without importing this package. */
export const FRIEND_PERFORMANCE_GLOBAL = '__DSH_FRIEND_PERFORMANCE__' as const

export function publishPerformanceTracker(tracker: PerformanceTracker): void {
  ;(globalThis as Record<string, unknown>)[FRIEND_PERFORMANCE_GLOBAL] = tracker
}

export function getSharedPerformanceTracker(): PerformanceTracker {
  return shared
}

/** Test seam: host apply() and companion-preset apply() share one process tracker. */
export function resetSharedPerformanceTracker(): void {
  shared = createPerformanceTracker()
  publishPerformanceTracker(shared)
}

export function applyStageTagEvents(
  tracker: PerformanceTracker,
  events: readonly StageTagEvent[],
): PerformanceSnapshot {
  for (const event of events) {
    if (!event.applied) continue
    if (event.kind === 'expr' && isHiyoriExpression(event.value)) {
      tracker.setExpression(event.value)
      continue
    }
    if (event.kind === 'motion' && isStageMotionGroup(event.value)) {
      tracker.setMotion(event.value)
      continue
    }
    if (event.kind === 'cue' && isStageCueName(event.value)) {
      tracker.playCue(event.value)
    }
  }
  return tracker.snapshot()
}
