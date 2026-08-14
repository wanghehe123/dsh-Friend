/**
 * Synthesis queue: global concurrency 3, one in-flight job per session so
 * playback order matches enqueue order inside a session. `clear()` drops
 * pending jobs (in-flight work finishes).
 */

export const FRIEND_TTS_QUEUE_CONCURRENCY = 3
export const FRIEND_TTS_DEFAULT_SESSION = 'default'
export const FRIEND_TTS_QUEUE_CLEARED = 'dsh-friend-tts: queue cleared'

export type FriendTtsQueueTask<T> = () => Promise<T>

export type FriendTtsEnqueueOptions = {
  sessionId?: string
}

export type FriendTtsQueueSize = {
  pending: number
  running: number
}

export interface FriendTtsQueue {
  enqueue<T>(task: FriendTtsQueueTask<T>, options?: FriendTtsEnqueueOptions): Promise<T>
  clear(sessionId?: string): void
  size(): FriendTtsQueueSize
  dispose(): void
}

type PendingJob = {
  sessionId: string
  run: () => Promise<void>
  cancel: (error: Error) => void
}

export function createFriendTtsQueue(concurrency = FRIEND_TTS_QUEUE_CONCURRENCY): FriendTtsQueue {
  const limit = Math.max(1, concurrency)
  const pending: PendingJob[] = []
  const runningSessions = new Set<string>()
  let running = 0
  let disposed = false

  const pump = (): void => {
    if (disposed) {
      return
    }
    while (running < limit) {
      const index = pending.findIndex((job) => !runningSessions.has(job.sessionId))
      if (index < 0) {
        return
      }
      const job = pending.splice(index, 1)[0]
      if (job === undefined) {
        return
      }
      running += 1
      runningSessions.add(job.sessionId)
      void job.run().finally(() => {
        running -= 1
        runningSessions.delete(job.sessionId)
        pump()
      })
    }
  }

  return {
    enqueue(task, options) {
      if (disposed) {
        return Promise.reject(new Error(FRIEND_TTS_QUEUE_CLEARED))
      }
      const sessionId = options?.sessionId?.trim() || FRIEND_TTS_DEFAULT_SESSION
      return new Promise((resolve, reject) => {
        const job: PendingJob = {
          sessionId,
          cancel: reject,
          run: async () => {
            try {
              resolve(await task())
            } catch (error) {
              reject(error)
            }
          },
        }
        pending.push(job)
        pump()
      })
    },

    clear(sessionId) {
      const error = new Error(FRIEND_TTS_QUEUE_CLEARED)
      const match = sessionId === undefined
        ? pending.splice(0, pending.length)
        : takeWhere(pending, (job) => job.sessionId === sessionId)
      for (const job of match) {
        job.cancel(error)
      }
    },

    size() {
      return { pending: pending.length, running }
    },

    dispose() {
      disposed = true
      this.clear()
    },
  }
}

function takeWhere<T>(items: T[], predicate: (item: T) => boolean): T[] {
  const taken: T[] = []
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (item !== undefined && predicate(item)) {
      taken.push(item)
      items.splice(i, 1)
    }
  }
  taken.reverse()
  return taken
}
