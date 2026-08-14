import { describe, expect, it } from 'vitest'
import type { WorkSignal } from '../src/work-cue.ts'

type WorkCueModule = {
  resolveWorkCue: (signal: WorkSignal) => {
    expression: string
    motionGroup: string
    loop: boolean
  }
}

async function loadWorkCue(): Promise<WorkCueModule | undefined> {
  const source = new URL('../src/work-cue.ts', import.meta.url).href
  try {
    return await import(/* @vite-ignore */ source) as WorkCueModule
  } catch {
    return undefined
  }
}

describe('work cue contract', () => {
  it('keeps the model in a calm looping idle pose when work is idle', async () => {
    const stage = await loadWorkCue()

    expect(stage, 'stage cue resolver must exist').toBeDefined()
    expect(stage?.resolveWorkCue({ kind: 'idle' })).toEqual({
      expression: 'neutral',
      motionGroup: 'Idle',
      loop: true,
    })
  })

  it('uses a one-shot surprised cue when work fails', async () => {
    const stage = await loadWorkCue()

    expect(stage, 'stage cue resolver must exist').toBeDefined()
    expect(stage?.resolveWorkCue({ kind: 'error' })).toEqual({
      expression: 'surprised',
      motionGroup: 'Error',
      loop: false,
    })
  })

  it('maps active work and success to the portable seven-expression vocabulary', async () => {
    const stage = await loadWorkCue()

    expect(stage, 'stage cue resolver must exist').toBeDefined()
    expect(stage?.resolveWorkCue({ kind: 'thinking' })).toEqual({
      expression: 'neutral',
      motionGroup: 'Thinking',
      loop: true,
    })
    expect(stage?.resolveWorkCue({ kind: 'success' })).toEqual({
      expression: 'happy',
      motionGroup: 'Celebrate',
      loop: false,
    })
  })

  it('covers every standard expression requested for the companion', async () => {
    const stage = await loadWorkCue()

    expect(stage, 'stage cue resolver must exist').toBeDefined()
    expect(stage?.resolveWorkCue({ kind: 'happy' })).toEqual({
      expression: 'happy',
      motionGroup: 'Smile',
      loop: false,
    })
    expect(stage?.resolveWorkCue({ kind: 'shy' })).toEqual({
      expression: 'shy',
      motionGroup: 'Embarrassed',
      loop: false,
    })
    expect(stage?.resolveWorkCue({ kind: 'sad' })).toEqual({
      expression: 'sad',
      motionGroup: 'Sad',
      loop: false,
    })
    expect(stage?.resolveWorkCue({ kind: 'angry' })).toEqual({
      expression: 'angry',
      motionGroup: 'Angry',
      loop: false,
    })
    expect(stage?.resolveWorkCue({ kind: 'sleepy' })).toEqual({
      expression: 'sleepy',
      motionGroup: 'Sleepy',
      loop: true,
    })
  })

  it('rejects unknown state names instead of silently producing a broken model command', async () => {
    const stage = await loadWorkCue()

    expect(stage, 'stage cue resolver must exist').toBeDefined()
    expect(() => stage?.resolveWorkCue({ kind: 'unknown' as never })).toThrow(
      'Unsupported dsh-Friend stage signal: unknown',
    )
  })
})
