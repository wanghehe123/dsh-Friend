import { describe, expect, it, vi } from 'vitest'

import { createStreamingTtsPreparer } from '../src/prepare.ts'
import { createCompanionTtsSpeaker } from '../src/reply-speaker.ts'

const RAW = '你好[expr:happy]世界[motion:Smile]呀[cue:success]！尾巴'

describe('createStreamingTtsPreparer', () => {
  it('never leaks protocol tags across a per-character stream', () => {
    const preparer = createStreamingTtsPreparer()
    const spoken: string[] = []
    let display = ''
    for (const char of RAW) {
      const delta = preparer.push(char)
      display = delta.displayText
      expect(delta.displayDelta).not.toMatch(/\[(?:expr|motion|cue):/u)
      expect(delta.ttsDelta).not.toMatch(/\[(?:expr|motion|cue):/u)
      spoken.push(...delta.sentences)
    }
    const flushed = preparer.flush()
    spoken.push(...flushed.sentences)
    expect(display + flushed.displayDelta).toBe('你好世界呀！尾巴')
    expect(spoken.join('')).not.toMatch(/\[(?:expr|motion|cue):/u)
    expect(spoken).toEqual(['你好世界呀！', '尾巴'])
  })
})

describe('createCompanionTtsSpeaker', () => {
  it('enqueues stripped sentences and stays silent when autoSpeak is off', () => {
    const speakSentence = vi.fn()
    let autoSpeak = true
    const speaker = createCompanionTtsSpeaker({
      speakSentence,
      getAutoSpeak: () => autoSpeak,
    })
    speaker.accept({
      sessionId: 's',
      rawDelta: '',
      done: false,
      mode: 'replace',
      reset: true,
    })
    for (const char of RAW) {
      speaker.accept({
        sessionId: 's',
        rawDelta: char,
        done: false,
        mode: 'append',
        reset: false,
      })
    }
    speaker.accept({
      sessionId: 's',
      rawDelta: '',
      done: true,
      mode: 'append',
      reset: false,
    })
    expect(speakSentence.mock.calls.map((call) => call[0])).toEqual(['你好世界呀！', '尾巴'])
    for (const call of speakSentence.mock.calls) {
      expect(String(call[0])).not.toMatch(/\[(?:expr|motion|cue):/u)
    }

    autoSpeak = false
    speakSentence.mockClear()
    speaker.accept({
      sessionId: 's2',
      rawDelta: '[expr:sad]关闭后不应合成。',
      done: true,
      mode: 'replace',
      reset: true,
    })
    expect(speakSentence).not.toHaveBeenCalled()
  })
})
