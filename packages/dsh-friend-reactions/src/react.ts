import { isDoNotDisturb } from './dnd.ts'
import { mapWorkEvent, type StageInstruction } from './mapping.ts'
import { assertPrivateEvent, type WorkEvent, type WorkEventKind } from './observe.ts'

import { attachQuip, createQuipPicker, type QuipPicker } from './quips.ts'
import type { ReactionLevel, ReactionSettings } from './settings.ts'

export type ReactionDecision =
  | { allowed: false; reason: 'disabled' | 'dnd' | 'muted' | 'global' | 'kind' | 'probability' }
  | { allowed: true }

export type ReactionSnapshot = {
  kind: WorkEventKind
  sessionId: string
  expression: StageInstruction['expression']
  motionGroup: StageInstruction['motionGroup']
  cue?: StageInstruction['cue']
  loop: boolean
  level: ReactionLevel
  quip?: string
  at: number
}

export type EnqueueTts = (text: string) => void

export type ReactEngineOptions = {
  settings: () => ReactionSettings
  now?: () => number
  random?: () => number
  enqueueTts?: EnqueueTts
  picker?: QuipPicker
}

export type ReactEngine = {
  decide(event: WorkEvent): ReactionDecision
  react(event: WorkEvent): ReactionSnapshot | undefined
  last(): ReactionSnapshot | undefined
}

export function createReactEngine(options: ReactEngineOptions): ReactEngine {
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  const picker = options.picker ?? createQuipPicker(random)
  let lastAny = Number.NEGATIVE_INFINITY
  const lastKind = new Map<WorkEventKind, number>()
  let lastSnapshot: ReactionSnapshot | undefined

  const decide = (event: WorkEvent): ReactionDecision => {
    assertPrivateEvent(event)
    const settings = options.settings()
    // `settings.enabled` is already `friend-core.enabled && friend-reactions.enabled`.
    if (!settings.enabled) {
      return { allowed: false, reason: 'disabled' }
    }
    if (settings.mutedSessions.includes(event.sessionId)) {
      return { allowed: false, reason: 'muted' }
    }
    if (isDoNotDisturb(new Date(now()), settings.quietHours, settings.quietCron)) {
      return { allowed: false, reason: 'dnd' }
    }
    const t = now()
    // turn-start always fires first and would otherwise spend the 45s global
    // window, so the same turn's celebration never starts. Kind cooldown still
    // spaces celebrations 5 minutes apart.
    if (event.kind !== 'turn-success' && t - lastAny < settings.globalCooldownMs) {
      return { allowed: false, reason: 'global' }
    }
    const previousKind = lastKind.get(event.kind)
    if (previousKind !== undefined && t - previousKind < settings.kindCooldownMs) {
      return { allowed: false, reason: 'kind' }
    }
    if (event.kind === 'turn-success' && random() >= settings.celebrateProbability) {
      return { allowed: false, reason: 'probability' }
    }
    return { allowed: true }
  }

  return {
    decide,
    react(event) {
      const decision = decide(event)
      if (!decision.allowed) {
        return undefined
      }
      const settings = options.settings()
      const instruction = mapWorkEvent(event.kind)
      const quip = attachQuip(settings.level, event.kind, settings.language, picker)
      const t = now()
      lastAny = t
      lastKind.set(event.kind, t)
      const snapshot: ReactionSnapshot = {
        kind: event.kind,
        sessionId: event.sessionId,
        expression: instruction.expression,
        motionGroup: instruction.motionGroup,
        loop: instruction.loop,
        level: settings.level,
        at: t,
      }
      if (instruction.cue !== undefined) {
        snapshot.cue = instruction.cue
      }
      if (quip !== undefined) {
        snapshot.quip = quip
      }
      if (settings.level === 'voice' && quip !== undefined) {
        options.enqueueTts?.(quip)
      }
      lastSnapshot = snapshot
      return snapshot
    },
    last() {
      return lastSnapshot
    },
  }
}
