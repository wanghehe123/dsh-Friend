import { describe, expect, it } from 'vitest'

import {
  isSpeakableText,
  prepareTtsText,
  splitSentences,
  stripMarkdown,
  stripParentheticalStageDirections,
} from '../src/prepare.ts'

describe('prepareTtsText (W-M2-6)', () => {
  it('strips stage tags and parentheticals: [expr:happy]你好（挥手） → 你好', () => {
    const prepared = prepareTtsText('[expr:happy]你好（挥手）')
    expect(prepared.speakable).toBe('你好')
    expect(prepared.speakable).not.toMatch(/\[(?:expr|motion|cue):/u)
    expect(prepared.speakable).not.toContain('挥手')
  })

  it('matches the spec example: tags + fullwidth aside + following sentence', () => {
    const prepared = prepareTtsText('[expr:happy]你好呀（轻轻挥手）今天过得怎么样？')
    expect(prepared.speakable).toBe('你好呀今天过得怎么样？')
  })

  it('keeps parentheticals when stripStageDirections is false, but still drops protocol tags', () => {
    const prepared = prepareTtsText('[expr:happy]你好（挥手）', { stripStageDirections: false })
    expect(prepared.speakable).toBe('你好（挥手）')
    expect(prepared.speakable).not.toMatch(/\[expr:/u)
  })

  it('strips markdown that should not be spoken', () => {
    expect(stripMarkdown('**你好** 和 [链接](https://example.com)')).toBe('你好 和 链接')
    const prepared = prepareTtsText('[expr:happy]**你好**')
    expect(prepared.speakable).toBe('你好')
  })
})

describe('old-repo prepareTextForTts cases', () => {
  it('removes parenthetical stage directions but keeps dialogue', () => {
    const input = [
      '啊——！💦（猝不及防地轻呼出声，身子像是触电一样软绵绵地缩了一下，脸颊瞬间染上一层绯红，眼神慌乱又羞恼地看向你）',
      '',
      '……坏、坏蛋！🥺 居然敢趁我不注意就动手动脚的……',
      '',
      '不过……（偷偷用余光瞥了一眼你屏幕上那个正在渲染的卧室图片，声音稍微放轻了一些）你也看到了嘛……',
      '',
      '喂，亲爱的 wish 老板，你是想先关掉我，还是想让我把背景换成那个温馨的卧室呀？😠🐶',
    ].join('\n')
    const spoken = stripParentheticalStageDirections(input)
    expect(spoken).not.toContain('猝不及防')
    expect(spoken).not.toContain('偷偷用余光')
    expect(spoken).toContain('坏、坏蛋')
    expect(spoken).toContain('你也看到了嘛')
    expect(spoken).toContain('温馨的卧室')
    expect(stripParentheticalStageDirections('你好 (smiles) 呀')).toBe('你好 呀')
  })
})

describe('sentence split (CJK / English mix)', () => {
  it('splits on CJK and ASCII terminators', () => {
    expect(splitSentences('你好。Hello world! 今天怎么样？')).toEqual([
      '你好。',
      'Hello world!',
      '今天怎么样？',
    ])
  })

  it('keeps a trailing clause without a terminator', () => {
    expect(splitSentences('第一句。还没说完')).toEqual(['第一句。', '还没说完'])
  })

  it('drops emoji-only fragments as unspeakable', () => {
    expect(isSpeakableText('😠🐶')).toBe(false)
    expect(isSpeakableText('你好')).toBe(true)
    const prepared = prepareTtsText('你好。😠')
    expect(prepared.sentences).toEqual(['你好。'])
  })
})
