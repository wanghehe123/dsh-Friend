import { describe, expect, it } from 'vitest'

import {
  applyStageTagEvents,
  createPerformanceTracker,
} from '../src/performance-state.ts'
import {
  MAX_STAGE_TAG_LENGTH,
  StreamingTagParser,
  concatTagParseDeltas,
  parseStageTags,
  type TagParseDelta,
} from '../src/tag-parser.ts'

const FIXTURE =
  '你好[expr:happy]世界[motion:Smile]呀[cue:success]！尾巴'

function parseAll(text: string): TagParseDelta {
  const parser = new StreamingTagParser()
  return concatTagParseDeltas([parser.push(text), parser.flush()])
}

function expectZeroLeak(result: TagParseDelta): void {
  expect(result.displayText).not.toMatch(/\[(?:expr|motion|cue):/u)
  expect(result.ttsText).not.toMatch(/\[(?:expr|motion|cue):/u)
  expect(result.displayText).toBe(result.ttsText)
}

describe('parseStageTags (whole string)', () => {
  it('strips protocol tags from display and TTS and emits them in order', () => {
    const result = parseStageTags(FIXTURE)
    expect(result.displayText).toBe('你好世界呀！尾巴')
    expect(result.ttsText).toBe('你好世界呀！尾巴')
    expect(result.events).toEqual([
      { kind: 'expr', value: 'happy', applied: true },
      { kind: 'motion', value: 'Smile', applied: true },
      { kind: 'cue', value: 'success', applied: true },
    ])
    expectZeroLeak(result)
  })

  it('passes malformed brackets through so prose is not swallowed', () => {
    const result = parseStageTags('看 array[0] 和 [this] 以及 [foo:bar]')
    expect(result.displayText).toBe('看 array[0] 和 [this] 以及 [foo:bar]')
    expect(result.ttsText).toBe(result.displayText)
    expect(result.events).toEqual([])
  })

  it('strips unknown vocabulary tokens without applying them (no protocol leak)', () => {
    const result = parseStageTags('开始[expr:excited]中间[motion:Tap]结束[cue:dance]')
    expect(result.displayText).toBe('开始中间结束')
    expect(result.ttsText).toBe('开始中间结束')
    expect(result.events).toEqual([
      { kind: 'expr', value: 'excited', applied: false },
      { kind: 'motion', value: 'Tap', applied: false },
      { kind: 'cue', value: 'dance', applied: false },
    ])
    expectZeroLeak(result)
  })

  it('treats empty and punctuated values as illegal passthrough', () => {
    const result = parseStageTags('[expr:][expr:happy face]正文')
    expect(result.displayText).toBe('[expr:][expr:happy face]正文')
    expect(result.events).toEqual([])
  })
})

describe('StreamingTagParser cross-chunk splits', () => {
  it('yields the same result no matter where a multi-tag string is split', () => {
    const complete = parseAll(FIXTURE)
    expectZeroLeak(complete)

    for (let index = 0; index <= FIXTURE.length; index += 1) {
      const parser = new StreamingTagParser()
      const delta = concatTagParseDeltas([
        parser.push(FIXTURE.slice(0, index)),
        parser.push(FIXTURE.slice(index)),
        parser.flush(),
      ])
      expect(delta, `split at ${index}`).toEqual(complete)
    }
  })

  it('stays stable when every character is its own chunk', () => {
    const parser = new StreamingTagParser()
    const parts: TagParseDelta[] = []
    for (const char of FIXTURE) {
      parts.push(parser.push(char))
    }
    parts.push(parser.flush())
    expect(concatTagParseDeltas(parts)).toEqual(parseAll(FIXTURE))
  })

  it('does not leak tag fragments while a tag is split across chunks', () => {
    const parser = new StreamingTagParser()
    const first = parser.push('[ex')
    expect(first.displayText).toBe('')
    expect(first.ttsText).toBe('')
    expect(first.events).toEqual([])

    const second = parser.push('pr:happy]你好')
    expect(second.displayText).toBe('你好')
    expect(second.ttsText).toBe('你好')
    expect(second.events).toEqual([{ kind: 'expr', value: 'happy', applied: true }])
    expect(parser.flush()).toEqual({ displayText: '', ttsText: '', events: [] })
  })
})

describe('unclosed and oversized tags', () => {
  it('releases an unclosed buffer as ordinary text on flush so body is not kept forever', () => {
    const parser = new StreamingTagParser()
    expect(parser.push('hello [expr:hap').displayText).toBe('hello ')
    const flushed = parser.flush()
    expect(flushed.displayText).toBe('[expr:hap')
    expect(flushed.ttsText).toBe('[expr:hap')
    expect(flushed.events).toEqual([])
  })

  it('emits an oversized unclosed buffer as text instead of stalling the stream', () => {
    const parser = new StreamingTagParser()
    const oversized = `[${'x'.repeat(MAX_STAGE_TAG_LENGTH)}`
    const delta = parser.push(`${oversized}后面`)
    expect(delta.displayText.startsWith('[')).toBe(true)
    expect(delta.displayText.endsWith('后面')).toBe(true)
    expect(delta.displayText).toContain('x')
    expect(parser.flush().displayText).toBe('')
  })

  it('restarts on a new [ so a later valid tag is not trapped in a false start', () => {
    const result = parseStageTags('foo [ bar [expr:sad] baz')
    expect(result.displayText).toBe('foo [ bar  baz')
    expect(result.events).toEqual([{ kind: 'expr', value: 'sad', applied: true }])
  })
})

describe('applied tags drive the performance snapshot; unknown words do not', () => {
  it('updates expression/motion/cue in order and ignores unknown tokens', () => {
    const tracker = createPerformanceTracker()
    const parsed = parseStageTags('[expr:happy][expr:excited][motion:Celebrate][cue:error]')
    applyStageTagEvents(tracker, parsed.events)
    expect(tracker.snapshot()).toMatchObject({
      expression: 'surprised',
      motionGroup: 'Error',
      cue: 'error',
      lastAction: 'cue',
      seq: 3,
    })
  })
})
