import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAsrSession } from '../src/session.ts'
import { createFakeEngine } from './helpers/speech-recognition.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('AsrSession binder', () => {
  it('starts/stops the engine from hold events and sends on release', () => {
    const fake = createFakeEngine()
    const sent: string[] = []
    const barged: number[] = []
    const session = createAsrSession({
      engine: fake.engine,
      onSend: (text) => {
        sent.push(text)
      },
      onBargeIn: () => {
        barged.push(Date.now())
      },
    })

    session.dispatch({ type: 'hotkey-down' })
    expect(fake.starts).toEqual(['hold'])
    expect(barged).toHaveLength(1)
    fake.emitPartial('今')
    fake.emitFinal('今天天气不错')
    session.dispatch({ type: 'hotkey-up' })

    expect(fake.stops).toBe(1)
    expect(sent).toEqual(['今天天气不错'])
    session.dispose()
  })

  it('auto-listen sends after 1.2s of silence and not while speech continues', () => {
    vi.useFakeTimers()
    const fake = createFakeEngine()
    const sent: string[] = []
    const session = createAsrSession({
      engine: fake.engine,
      mode: 'auto',
      onSend: (text) => {
        sent.push(text)
      },
    })
    expect(fake.starts).toEqual(['auto'])

    fake.emitPartial('你好')
    vi.advanceTimersByTime(1199)
    expect(sent).toEqual([])
    fake.emitPartial('你好啊')
    vi.advanceTimersByTime(1200)
    expect(sent).toEqual(['你好啊'])
    expect(session.getState().phase).toBe('listening')

    fake.emitFinal('第二句')
    vi.advanceTimersByTime(1200)
    expect(sent).toEqual(['你好啊', '第二句'])
    session.dispose()
  })

  it('engine error mid-speech stops without sending', () => {
    const fake = createFakeEngine()
    const sent: string[] = []
    const session = createAsrSession({
      engine: fake.engine,
      onSend: (text) => {
        sent.push(text)
      },
    })
    session.dispatch({ type: 'hotkey-down' })
    fake.emitPartial('半句')
    fake.emitError('audio-capture')
    expect(session.getState().phase).toBe('idle')
    expect(session.getState().lastError).toBe('audio-capture')
    expect(sent).toEqual([])
    expect(fake.stops).toBeGreaterThanOrEqual(1)
    session.dispose()
  })

  it('sends a trailing final that arrives after hold release (endpoint stop-then-upload)', () => {
    const fake = createFakeEngine('endpoint')
    const sent: string[] = []
    const session = createAsrSession({
      engine: fake.engine,
      onSend: (text) => {
        sent.push(text)
      },
    })
    session.dispatch({ type: 'hotkey-down' })
    expect(session.getState().phase).toBe('listening')
    session.dispatch({ type: 'hotkey-up' })
    expect(session.getState().phase).toBe('idle')
    expect(sent).toEqual([])
    fake.emitFinal('壳内转写成功')
    expect(sent).toEqual(['壳内转写成功'])
    fake.emitFinal('不应再发')
    expect(sent).toEqual(['壳内转写成功'])
    session.dispose()
  })

  it('does not double-send when a final already landed before hold release', () => {
    const fake = createFakeEngine()
    const sent: string[] = []
    const session = createAsrSession({
      engine: fake.engine,
      onSend: (text) => {
        sent.push(text)
      },
    })
    session.dispatch({ type: 'hotkey-down' })
    fake.emitFinal('今天天气不错')
    session.dispatch({ type: 'hotkey-up' })
    fake.emitFinal('今天天气不错')
    expect(sent).toEqual(['今天天气不错'])
    session.dispose()
  })

  it('submitFinal trims and uses the same onSend path as an engine final', () => {
    const fake = createFakeEngine()
    const sent: string[] = []
    const session = createAsrSession({
      engine: fake.engine,
      onSend: (text) => {
        sent.push(text)
      },
    })
    session.submitFinal('  可编程终稿  ')
    session.submitFinal('   ')
    expect(sent).toEqual(['可编程终稿'])
    session.dispose()
  })

  it('does not call onBargeIn when bargeIn is off', () => {
    const fake = createFakeEngine()
    const barged = vi.fn()
    const session = createAsrSession({
      engine: fake.engine,
      bargeIn: false,
      onBargeIn: barged,
    })
    session.dispatch({ type: 'hotkey-down' })
    expect(barged).not.toHaveBeenCalled()
    session.dispose()
  })
})
