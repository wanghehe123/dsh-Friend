import { describe, expect, it } from 'vitest'

import {
  assignSortOrder,
  batchRanges,
  composeMemoryContent,
  DEFAULT_EPISODE_IMPORTANCE,
  MIN_REFLECTION_IMPORTANCE,
  occurredAtUnix,
  parseExpandResponse,
  parseOutlineResponse,
  parseReflectResponse,
  type GrowthBeat,
} from '../src/pure.ts'

function sampleBeat(age: number | undefined, kind: string, narrative: string): GrowthBeat {
  const beat: GrowthBeat = {
    id: 'x',
    characterId: 'char-a',
    batchId: 'batch-1',
    kind,
    title: 'title',
    narrative,
    traitEffect: '',
    importance: 0.5,
    status: 'draft',
    sortOrder: 99,
  }
  if (age !== undefined) {
    beat.age = age
  }
  return beat
}

describe('parse_outline (Rust translations)', () => {
  it('strips markdown json fences', () => {
    const raw = '```json\n{"events":[{"age":8,"title":"雨夜","summary":"停电的晚上我第一次自己点灯。","node_id":1}]}\n```'
    const events = parseOutlineResponse(raw)
    expect(events).toHaveLength(1)
    expect(events[0]?.age).toBe(8)
    expect(events[0]?.title).toBe('雨夜')
    expect(events[0]?.nodeId).toBe(1)
  })

  it('extracts json wrapped in prose', () => {
    const raw = '好的，这是时间线骨架：\n{"events":[{"age":7,"title":"雨夜","summary":"那天晚上停电了。","node_id":null}]}\n希望这些事件够用。'
    const events = parseOutlineResponse(raw)
    expect(events).toHaveLength(1)
    expect(events[0]?.age).toBe(7)
    expect(events[0]?.title).toBe('雨夜')
    expect(events[0]?.nodeId).toBeUndefined()
  })

  it('skips entries missing required fields', () => {
    const raw = `{"events":[
            {"age":9,"title":"离家","summary":"我提着箱子上了火车。"},
            {"age":10},
            {"title":"无年龄","summary":"没有岁数就不能落在时间线上。"},
            {"age":11,"summary":"只有梗概也可以。"}
        ]}`
    const events = parseOutlineResponse(raw)
    expect(events.map((event) => event.age)).toEqual([9, 11])
    expect(events[1]?.title).toBe(Array.from('只有梗概也可以。').slice(0, 20).join(''))
    expect(events[1]?.summary).toBe('只有梗概也可以。')
  })

  it('coerces string age to integer', () => {
    const raw = '{"events":[{"age":"12","title":"入学","summary":"我走进了新的校门。","node_id":"3"}]}'
    const events = parseOutlineResponse(raw)
    expect(events[0]?.age).toBe(12)
    expect(events[0]?.nodeId).toBe(3)
  })

  it('rejects non-json with a clear error', () => {
    expect(() => parseOutlineResponse('sorry I cannot do that')).toThrow(/json/i)
    try {
      parseOutlineResponse('sorry I cannot do that')
    } catch (error) {
      expect(String(error)).toContain('sorry')
    }
  })
})

describe('parse_expand / parse_reflect (Rust translations)', () => {
  it('fills defaults for optional expand fields', () => {
    const raw = 'Here you go:\n{"beats":[{"age":"12","title":"入学","narrative":"那天天很蓝，操场上的白线还没干。"}]}\n'
    const beats = parseExpandResponse(raw)
    expect(beats).toHaveLength(1)
    expect(beats[0]?.age).toBe(12)
    expect(beats[0]?.kind).toBe('episode')
    expect(beats[0]?.traitEffect).toBe('')
    expect(beats[0]?.nodeId).toBeUndefined()
    expect(beats[0]?.importance).toBe(DEFAULT_EPISODE_IMPORTANCE)
    expect(beats[0]?.narrative).toContain('操场')
  })

  it('clamps reflection importance and reads summary', () => {
    const raw = '```JSON\n{"reflections":[{"title":"独立","narrative":"我只能靠自己。","importance":0.5}],"life_story_summary":"她独自长大。"}\n```'
    const result = parseReflectResponse(raw)
    expect(result.reflections).toHaveLength(1)
    expect(result.reflections[0]?.kind).toBe('reflection')
    expect(result.reflections[0]?.age).toBeUndefined()
    expect(result.reflections[0]?.importance).toBe(MIN_REFLECTION_IMPORTANCE)
    expect(result.lifeStorySummary).toBe('她独自长大。')
  })
})

describe('sort / time / compose (Rust translations)', () => {
  it('assign_sort_order is chronological and contiguous from zero', () => {
    const beats = [
      sampleBeat(30, 'episode', 'thirty'),
      sampleBeat(10, 'episode', 'ten'),
      sampleBeat(undefined, 'reflection', 'belief'),
      sampleBeat(20, 'episode', 'twenty'),
    ]
    assignSortOrder(beats)
    expect(beats.map((beat) => beat.age)).toEqual([10, 20, 30, undefined])
    expect(beats.map((beat) => beat.sortOrder)).toEqual([0, 1, 2, 3])
    expect(beats[3]?.kind).toBe('reflection')
  })

  it('occurred_at_unix is none when birth year or age is missing', () => {
    expect(occurredAtUnix(undefined, 8)).toBeUndefined()
    expect(occurredAtUnix(1998, undefined)).toBeUndefined()
    expect(occurredAtUnix(undefined, undefined)).toBeUndefined()
  })

  it('occurred_at_unix is January first of birth year plus age', () => {
    expect(occurredAtUnix(1998, 8)).toBe(1_136_073_600)
    expect(occurredAtUnix(1998, 0)).toBe(883_612_800)
    expect(occurredAtUnix(Number.MAX_SAFE_INTEGER, 1)).toBeUndefined()
  })

  it('compose_memory_content prefixes episode with fullwidth age', () => {
    expect(composeMemoryContent(sampleBeat(8, 'episode', '我走了。'))).toBe('（8岁）我走了。')
    expect(composeMemoryContent(sampleBeat(undefined, 'episode', '我走了。'))).toBe('我走了。')
  })

  it('compose_memory_content does not prefix reflection', () => {
    expect(composeMemoryContent(sampleBeat(20, 'reflection', '我只能靠自己。'))).toBe('我只能靠自己。')
  })

  it('batch_ranges prefer three-to-four and avoid a final singleton', () => {
    expect(batchRanges(0)).toEqual([])
    expect(batchRanges(4)).toEqual([[0, 4]])
    expect(batchRanges(5)).toEqual([[0, 3], [3, 5]])
    expect(batchRanges(9)).toEqual([[0, 4], [4, 7], [7, 9]])
  })
})
