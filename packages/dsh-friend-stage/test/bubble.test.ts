import { describe, expect, it, vi } from 'vitest'

import { createBubbleController, handleBubbleKeydown } from '../src/bubble.ts'

describe('bubble shortcut chat', () => {
  it('renders streaming assistant chunks into the open bubble', () => {
    const send = vi.fn(async () => undefined)
    const bubble = createBubbleController({ send, timeoutMs: 5_000, now: () => 0 })

    bubble.applyChatSnapshot({ status: 'typing', assistantText: '你', typing: true, error: '' })
    expect(bubble.getState()).toMatchObject({ open: true, assistantText: '你', typing: true })

    bubble.applyChatSnapshot({ status: 'typing', assistantText: '你好', typing: true, error: '' })
    bubble.applyChatSnapshot({ status: 'ready', assistantText: '你好呀', typing: false, error: '' })
    expect(bubble.getState()).toMatchSnapshot()
  })

  it('sends on Enter exactly once', async () => {
    const send = vi.fn(async () => undefined)
    const bubble = createBubbleController({ send })
    bubble.setInput('你好')
    handleBubbleKeydown({
      key: 'Enter',
      shiftKey: false,
      preventDefault() {},
    }, bubble)
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1)
    })
    expect(send).toHaveBeenCalledWith('你好')
    expect(bubble.getState().input).toBe('')
    expect(bubble.getState().typing).toBe(true)
  })

  it('auto-collapses after the configured timeout', () => {
    let now = 1_000
    const bubble = createBubbleController({
      send: async () => undefined,
      timeoutMs: 2_000,
      now: () => now,
    })
    bubble.applyChatSnapshot({ status: 'ready', assistantText: '好的', typing: false, error: '' })
    expect(bubble.getState().open).toBe(true)
    now = 2_999
    bubble.tick(now)
    expect(bubble.getState().open).toBe(true)
    now = 3_000
    bubble.tick(now)
    expect(bubble.getState().open).toBe(false)
  })

  it('does not reset the hide timer when the same snapshot is applied again', () => {
    let now = 1_000
    const bubble = createBubbleController({
      send: async () => undefined,
      timeoutMs: 2_000,
      now: () => now,
    })
    bubble.applyChatSnapshot({ status: 'ready', assistantText: '好的', typing: false, error: '' })
    now = 2_500
    bubble.applyChatSnapshot({ status: 'ready', assistantText: '好的', typing: false, error: '' })
    now = 3_000
    bubble.tick(now)
    expect(bubble.getState().open).toBe(false)
  })

  it('does not open an empty idle snapshot', () => {
    const bubble = createBubbleController({ send: async () => undefined })
    bubble.applyChatSnapshot({ status: 'ready', assistantText: '', typing: false, error: '' })
    expect(bubble.getState().open).toBe(false)
  })
})
