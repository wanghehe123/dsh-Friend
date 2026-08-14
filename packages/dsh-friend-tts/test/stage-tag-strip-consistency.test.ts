import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { parseStageTags } from '@wishp3/dsh-friend-stage/tags'

import { prepareTtsText, stripStageProtocolTags } from '../src/prepare.ts'

/**
 * Drift lock: TTS protocol-tag stripping must be stage's `ttsText`, not a
 * second closed-tag regex. Same complete string → same protocol-stripped
 * text, including illegal passthrough and the 48-char buffer limit.
 */
const PROTOCOL_CASES = [
  {
    label: 'known tags mixed with prose',
    text: '你好[expr:happy]世界[motion:Smile]呀[cue:success]！尾巴',
  },
  {
    label: 'unknown vocabulary still stripped (no protocol leak)',
    text: '开始[expr:excited]中间[motion:Tap]结束[cue:dance]',
  },
  {
    label: 'illegal tags pass through as prose',
    text: '看 array[0] 和 [this] 以及 [foo:bar]',
  },
  {
    label: 'empty and punctuated values pass through',
    text: '[expr:][expr:happy face]正文',
  },
  {
    label: 'restart on a later valid tag',
    text: 'foo [ bar [expr:sad] baz',
  },
  {
    label: 'unclosed tag remains text',
    text: 'hello [expr:hap',
  },
  {
    label: 'well-formed tag longer than MAX_STAGE_TAG_LENGTH stays text',
    text: `[expr:${'A'.repeat(42)}]后面`,
  },
  {
    label: 'well-formed tag at the length limit is stripped',
    text: `[expr:${'A'.repeat(41)}]后面`,
  },
  {
    label: 'adjacent tags and parentheticals (protocol only)',
    text: '[expr:happy]你好（挥手）[cue:success]',
  },
  {
    label: 'markdown is not part of the protocol contract',
    text: '[expr:happy]**你好**',
  },
] as const

describe('tts protocol strip matches stage ttsText', () => {
  it.each(PROTOCOL_CASES)('$label', ({ text }) => {
    const stageTts = parseStageTags(text).ttsText
    expect(stripStageProtocolTags(text)).toBe(stageTts)
    expect(prepareTtsText(text, { stripStageDirections: false }).displayText).toBe(stageTts)
  })

  it('strips via @wishp3/dsh-friend-stage/tags, not a local closed-tag regex', async () => {
    const source = await readFile(new URL('../src/prepare.ts', import.meta.url), 'utf8')
    expect(source).toContain('@wishp3/dsh-friend-stage/tags')
    expect(source).toContain('StreamingTagParser')
    expect(source).not.toContain('parseStageTags')
    expect(source).not.toMatch(/CLOSED_STAGE_TAG/)
    expect(source).not.toMatch(/\[\(expr\|motion\|cue\):/)
  })
})
