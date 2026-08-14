import { describe, expect, it } from 'vitest'

import { createCompanionStageSink } from '../src/reply-bridge.ts'
import { createChatTracker } from '../src/chat-state.ts'
import { createPerformanceTracker } from '../src/performance-state.ts'
import { createBubbleController } from '../src/bubble.ts'

const RAW = '你好[expr:happy]世界[motion:Smile]呀[cue:success]！尾巴'
const DISPLAY = '你好世界呀！尾巴'

describe('companion stage sink', () => {
  it('puts stripped body on the chat tracker, not a typing placeholder', () => {
    const chat = createChatTracker()
    const performance = createPerformanceTracker()
    const sink = createCompanionStageSink({ chat, performance })
    chat.beginSend('你好')
    chat.markSent('friend-companion-1')
    expect(chat.snapshot().assistantText).toBe('')
    expect(chat.snapshot().typing).toBe(true)

    sink.accept({
      sessionId: 'friend-companion-1',
      rawDelta: '',
      done: false,
      mode: 'replace',
      reset: true,
    })
    for (const char of RAW) {
      sink.accept({
        sessionId: 'friend-companion-1',
        rawDelta: char,
        done: false,
        mode: 'append',
        reset: false,
      })
    }
    sink.accept({
      sessionId: 'friend-companion-1',
      rawDelta: '',
      done: true,
      mode: 'append',
      reset: false,
    })

    const snap = chat.snapshot()
    expect(snap.assistantText).toBe(DISPLAY)
    expect(snap.assistantText).not.toMatch(/\[(?:expr|motion|cue):/u)
    expect(snap.assistantText).not.toBe('正在输入…')
    expect(snap.typing).toBe(false)
    expect(snap.status).toBe('ready')
    expect(performance.snapshot()).toMatchObject({
      expression: 'happy',
      motionGroup: 'Celebrate',
      cue: 'success',
      lastAction: 'cue',
    })
  })

  it('drives the bubble with body text instead of the typing-only placeholder', () => {
    const chat = createChatTracker()
    const performance = createPerformanceTracker()
    const sink = createCompanionStageSink({ chat, performance })
    const bubble = createBubbleController({ send: async () => undefined })
    sink.accept({
      sessionId: 's',
      rawDelta: '[expr:happy]你好呀',
      done: false,
      mode: 'replace',
      reset: false,
    })
    sink.accept({
      sessionId: 's',
      rawDelta: '',
      done: true,
      mode: 'append',
      reset: false,
    })
    bubble.applyChatSnapshot(chat.snapshot())
    expect(bubble.getState().assistantText).toBe('你好呀')
    expect(bubble.getState().assistantText).not.toMatch(/\[expr:/u)
    expect(bubble.getState().typing).toBe(false)
  })
})
