/**
 * Reentrant install-progress snapshots for SSE `asset-progress`.
 *
 * Browser `EventSource` reconnects automatically and does not replay missed
 * frames. Every push is the full current state (phase + totals + percent),
 * never a byte delta. New subscribers also `GET /friend/live2d/progress`.
 */

export const ASSET_PROGRESS_PHASES = [
  'idle',
  'downloading',
  'verifying',
  'extracting',
  'finalizing',
  'ready',
  'error',
] as const

export type AssetProgressPhase = (typeof ASSET_PROGRESS_PHASES)[number]

export type AssetProgressSnapshot = Readonly<{
  phase: AssetProgressPhase
  downloadedBytes: number
  totalBytes: number
  percent: number
  hashPending: boolean
  error?: string
}>

export const IDLE_ASSET_PROGRESS: AssetProgressSnapshot = {
  phase: 'idle',
  downloadedBytes: 0,
  totalBytes: 0,
  percent: 0,
  hashPending: false,
}

export type AssetProgressListener = (snapshot: AssetProgressSnapshot) => void

export function createAssetProgressSnapshot(input: {
  phase: AssetProgressPhase
  downloadedBytes: number
  totalBytes: number
  hashPending: boolean
  error?: string
}): AssetProgressSnapshot {
  const downloadedBytes = Math.max(0, input.downloadedBytes)
  const totalBytes = Math.max(0, input.totalBytes)
  const percent = percentFor(input.phase, downloadedBytes, totalBytes)
  const snapshot: AssetProgressSnapshot = {
    phase: input.phase,
    downloadedBytes,
    totalBytes,
    percent,
    hashPending: input.hashPending,
  }
  if (input.error === undefined) return snapshot
  return { ...snapshot, error: input.error }
}

function percentFor(phase: AssetProgressPhase, downloadedBytes: number, totalBytes: number): number {
  if (phase === 'idle') return 0
  if (phase === 'ready') return 100
  if (phase === 'error') {
    return totalBytes > 0 ? Math.min(99, Math.floor((downloadedBytes / totalBytes) * 100)) : 0
  }
  if (totalBytes <= 0) return phase === 'downloading' ? 0 : 99
  if (phase === 'downloading') {
    return Math.min(99, Math.floor((downloadedBytes / totalBytes) * 100))
  }
  return 99
}

export function createAssetProgressTracker(initial: AssetProgressSnapshot = IDLE_ASSET_PROGRESS) {
  let current = initial
  const listeners = new Set<AssetProgressListener>()
  return {
    snapshot(): AssetProgressSnapshot {
      return current
    },
    set(next: AssetProgressSnapshot): AssetProgressSnapshot {
      current = next
      for (const listener of listeners) listener(current)
      return current
    },
    subscribe(listener: AssetProgressListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export type AssetProgressTracker = ReturnType<typeof createAssetProgressTracker>
