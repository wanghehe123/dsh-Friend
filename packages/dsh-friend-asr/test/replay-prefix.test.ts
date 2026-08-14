import { describe, expect, it } from 'vitest'

import { stripReplayPrefix } from '../src/replay-prefix.ts'

describe('stripReplayPrefix', () => {
  it('drops an exact replay and a glued previous+next utterance', () => {
    const previous = '我觉得你非常的OK啊如此可教也'
    const next = '不过我觉得你还应该还有很多能进步的空间你觉得怎么样'
    expect(stripReplayPrefix(previous, previous)).toBe('')
    expect(stripReplayPrefix(previous + next, previous)).toBe(next)
    expect(stripReplayPrefix(next, previous)).toBe(next)
    expect(stripReplayPrefix('  下一句  ', '')).toBe('下一句')
    expect(stripReplayPrefix('hello world', 'hello')).toBe(' world')
  })
})
