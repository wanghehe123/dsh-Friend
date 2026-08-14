/**
 * Reentrant growth-progress snapshots.
 *
 * Shape matches stage `asset-progress` (phase / totals / percent) so a
 * reconnecting EventSource can paint the current state from one frame.
 * Extra growth fields (current / message / batchId) sit alongside.
 */

export const GROWTH_PROGRESS_PHASES = [
  'idle',
  'outline',
  'expand',
  'reflect',
  'complete',
  'error',
] as const

export type GrowthProgressPhase = (typeof GROWTH_PROGRESS_PHASES)[number]

export type GrowthProgressSnapshot = Readonly<{
  phase: GrowthProgressPhase
  downloadedBytes: number
  totalBytes: number
  percent: number
  hashPending: false
  current: number
  total: number
  message: string
  batchId: string
  error?: string
}>

export const IDLE_GROWTH_PROGRESS: GrowthProgressSnapshot = {
  phase: 'idle',
  downloadedBytes: 0,
  totalBytes: 0,
  percent: 0,
  hashPending: false,
  current: 0,
  total: 0,
  message: '',
  batchId: '',
}

export type GrowthProgressListener = (snapshot: GrowthProgressSnapshot) => void

export function createGrowthProgressSnapshot(input: {
  phase: GrowthProgressPhase
  current: number
  total: number
  message: string
  batchId: string
  error?: string
}): GrowthProgressSnapshot {
  const current = Math.max(0, input.current)
  const total = Math.max(0, input.total)
  const percent = percentFor(input.phase, current, total)
  const snapshot: GrowthProgressSnapshot = {
    phase: input.phase,
    downloadedBytes: current,
    totalBytes: total,
    percent,
    hashPending: false,
    current,
    total,
    message: input.message,
    batchId: input.batchId,
  }
  if (input.error === undefined) {
    return snapshot
  }
  return { ...snapshot, error: input.error }
}

function percentFor(phase: GrowthProgressPhase, current: number, total: number): number {
  if (phase === 'idle') {
    return 0
  }
  if (phase === 'complete') {
    return 100
  }
  if (phase === 'error') {
    return total > 0 ? Math.min(99, Math.floor((current / total) * 100)) : 0
  }
  if (total <= 0) {
    return phase === 'outline' ? 5 : 50
  }
  const base = phase === 'outline' ? 0 : phase === 'expand' ? 15 : 80
  const span = phase === 'outline' ? 15 : phase === 'expand' ? 65 : 19
  const slice = Math.floor((current / total) * span)
  return Math.min(99, base + slice)
}

export function createGrowthProgressTracker(initial: GrowthProgressSnapshot = IDLE_GROWTH_PROGRESS) {
  let current = initial
  const listeners = new Set<GrowthProgressListener>()
  return {
    snapshot(): GrowthProgressSnapshot {
      return current
    },
    set(next: GrowthProgressSnapshot): GrowthProgressSnapshot {
      current = next
      for (const listener of listeners) {
        listener(current)
      }
      return current
    },
    subscribe(listener: GrowthProgressListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export type GrowthProgressTracker = ReturnType<typeof createGrowthProgressTracker>
