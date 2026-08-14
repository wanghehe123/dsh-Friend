import { describe, expect, it } from 'vitest'

import { createGrowthProgressSnapshot } from '../src/progress.ts'
import type { GrowthBeat } from '../src/pure.ts'
import { renderGrowthPage } from '../src/ui-page.ts'
import { beatPreviewRows, renderProgressLabel, selectedBeats, toggleExcluded } from '../src/ui-state.ts'

function beat(id: string, title: string): GrowthBeat {
  return {
    id,
    characterId: 'default',
    batchId: 'b1',
    kind: 'episode',
    title,
    narrative: title,
    traitEffect: '',
    importance: 0.7,
    status: 'draft',
    sortOrder: 0,
  }
}

describe('growth UI state', () => {
  it('renders a progress label from a reentrant snapshot', () => {
    const snapshot = createGrowthProgressSnapshot({
      phase: 'expand',
      current: 1,
      total: 3,
      message: 'expanding batch 2/3',
      batchId: 'b1',
    })
    expect(snapshot.percent).toBeGreaterThan(0)
    expect(snapshot.percent).toBeLessThan(100)
    expect(renderProgressLabel(snapshot)).toContain('expand')
    expect(renderProgressLabel(snapshot)).toContain('1/3')
  })

  it('keeps the submit set equal to unchecked-excluded beats', () => {
    const beats = [beat('a', '雨夜'), beat('b', '离家'), beat('c', '入学')]
    expect(toggleExcluded([], 'b')).toEqual(['b'])
    expect(toggleExcluded(['b'], 'b')).toEqual([])
    const selected = selectedBeats(beats, ['b'])
    expect(selected.map((item) => item.id)).toEqual(['a', 'c'])
    expect(beatPreviewRows(beats, ['b']).map((row) => row.included)).toEqual([true, false, true])
  })

  it('serves a page with generate / continue / progress / commit controls', () => {
    const html = renderGrowthPage()
    expect(html).toContain('开始模拟人生')
    expect(html).toContain('续写')
    expect(html).toContain('写入记忆库')
    expect(html).toContain('目标语言')
    expect(html).toContain('模型 override')
    expect(html).toContain('/friend/growth/generate')
    expect(html).toContain('/friend/growth/commit')
    expect(html).toContain('/friend/growth/events')
    expect(html).toContain('id="bar"')
    expect(html).toContain('data-growth-step="1"')
    expect(html).toContain('data-growth-step="2"')
    expect(html).toContain('data-growth-step="3"')
    expect(html).toContain('--dsw-alias-bg-layer-2')
    expect(html).not.toContain('#0f172a')
  })
})
