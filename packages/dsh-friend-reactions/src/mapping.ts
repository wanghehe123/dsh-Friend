import type { WorkEventKind } from './observe.ts'

export type StageInstruction = {
  expression: 'neutral' | 'happy' | 'shy' | 'sad' | 'angry' | 'surprised' | 'sleepy'
  motionGroup: 'Idle' | 'Thinking' | 'Celebrate' | 'Smile' | 'Embarrassed' | 'Sad' | 'Angry' | 'Error' | 'Sleepy'
  cue?: 'idle' | 'thinking' | 'success' | 'error' | 'happy' | 'shy' | 'sad' | 'angry' | 'sleepy'
  loop: boolean
}

/** Built-in §5.8 mapping. Portable stage vocabulary, not model asset names. */
export const REACTION_MAPPING: Record<WorkEventKind, StageInstruction> = {
  'turn-start': {
    expression: 'neutral',
    motionGroup: 'Thinking',
    cue: 'thinking',
    loop: true,
  },
  'tool-error': {
    expression: 'surprised',
    motionGroup: 'Error',
    cue: 'error',
    loop: false,
  },
  'turn-success': {
    expression: 'happy',
    motionGroup: 'Celebrate',
    cue: 'success',
    loop: false,
  },
}

export function mapWorkEvent(kind: WorkEventKind): StageInstruction {
  return REACTION_MAPPING[kind]
}
