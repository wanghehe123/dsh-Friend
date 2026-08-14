import type { GrowthProgressSnapshot } from './progress.ts'
import type { GrowthBeat } from './pure.ts'

export function selectedBeats(
  beats: readonly GrowthBeat[],
  excludedIds: readonly string[],
): GrowthBeat[] {
  const skip = new Set(excludedIds)
  return beats.filter((beat) => !skip.has(beat.id))
}

export function toggleExcluded(excludedIds: readonly string[], id: string): string[] {
  const skip = new Set(excludedIds)
  if (skip.has(id)) {
    skip.delete(id)
    return [...skip]
  }
  skip.add(id)
  return [...skip]
}

export function renderProgressLabel(snapshot: GrowthProgressSnapshot): string {
  if (snapshot.phase === 'idle') {
    return '尚未生成'
  }
  if (snapshot.phase === 'complete') {
    return `完成 ${snapshot.percent}% · ${snapshot.message}`
  }
  if (snapshot.phase === 'error') {
    return `失败 · ${snapshot.error ?? snapshot.message}`
  }
  return `${snapshot.phase} ${snapshot.current}/${snapshot.total} · ${snapshot.percent}% · ${snapshot.message}`
}

export function beatPreviewRows(
  beats: readonly GrowthBeat[],
  excludedIds: readonly string[],
): Array<{ id: string; title: string; kind: string; age?: number; included: boolean }> {
  const skip = new Set(excludedIds)
  return beats.map((beat) => {
    const row: { id: string; title: string; kind: string; age?: number; included: boolean } = {
      id: beat.id,
      title: beat.title,
      kind: beat.kind,
      included: !skip.has(beat.id),
    }
    if (beat.age !== undefined) {
      row.age = beat.age
    }
    return row
  })
}
