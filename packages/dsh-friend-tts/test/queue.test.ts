import { describe, expect, it } from 'vitest'

import {
  FRIEND_TTS_QUEUE_CLEARED,
  FRIEND_TTS_QUEUE_CONCURRENCY,
  createFriendTtsQueue,
} from '../src/queue.ts'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

describe('TTS synthesis queue', () => {
  it('caps global concurrency at 3 across sessions', async () => {
    const queue = createFriendTtsQueue()
    expect(FRIEND_TTS_QUEUE_CONCURRENCY).toBe(3)
    let running = 0
    let maxRunning = 0
    const jobs = Array.from({ length: 6 }, (_, index) =>
      queue.enqueue(async () => {
        running += 1
        maxRunning = Math.max(maxRunning, running)
        await delay(15)
        running -= 1
        return index
      }, { sessionId: `s${String(index)}` }),
    )
    await expect(Promise.all(jobs)).resolves.toEqual([0, 1, 2, 3, 4, 5])
    expect(maxRunning).toBeLessThanOrEqual(3)
    queue.dispose()
  })

  it('keeps one in-flight job per session so order matches enqueue order', async () => {
    const queue = createFriendTtsQueue()
    const started: number[] = []
    const jobs = [0, 1, 2, 3, 4].map((index) =>
      queue.enqueue(async () => {
        started.push(index)
        await delay(8)
        return index
      }, { sessionId: 'chat-1' }),
    )
    await expect(Promise.all(jobs)).resolves.toEqual([0, 1, 2, 3, 4])
    expect(started).toEqual([0, 1, 2, 3, 4])
    queue.dispose()
  })

  it('clear() rejects pending jobs and leaves in-flight work alone', async () => {
    const queue = createFriendTtsQueue(1)
    let released = false
    const first = queue.enqueue(async () => {
      while (!released) {
        await delay(5)
      }
      return 'ran'
    }, { sessionId: 'a' })
    const pending = queue.enqueue(async () => 'nope', { sessionId: 'a' })
    queue.clear('a')
    await expect(pending).rejects.toThrow(FRIEND_TTS_QUEUE_CLEARED)
    released = true
    await expect(first).resolves.toBe('ran')
    queue.dispose()
  })
})
