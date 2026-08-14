/**
 * End-to-end lock for persona subscribe → stage bubble/tags → TTS speak.
 * Chunks are the official `assistant/chunk` text-delta shape. Every character
 * position is its own chunk so a split tag cannot leak.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  createCompanionSessionFilter,
  subscribeCompanionReplies,
  type SessionEventSource,
} from '@wish233/dsh-friend-persona'
import { FRIEND_PRESET_IDS } from '@wish233/dsh-friend-shared'
import {
  createBubbleController,
  createChatTracker,
  createCompanionStageSink,
  createPerformanceTracker,
} from '@wish233/dsh-friend-stage'

import { createFriendTtsCache } from '../src/cache.ts'
import { createFriendTtsQueue } from '../src/queue.ts'
import { createFriendTtsRouter } from '../src/router.ts'
import { createCompanionTtsSpeaker } from '../src/reply-speaker.ts'
import { createFriendTtsRegistry, type FriendTtsProvider } from '../src/seam.ts'
import { createFriendTtsService } from '../src/service.ts'

const RAW = '你好[expr:happy]世界[motion:Smile]呀[cue:success]！尾巴'
const DISPLAY = '你好世界呀！尾巴'

function companionSession(id = 'friend-companion-1') {
  return { id, header: { agentPreset: FRIEND_PRESET_IDS.companion } }
}

function createFakeSource(): {
  source: SessionEventSource
  emit(session: unknown, event: unknown): void
} {
  const handlers = new Set<(session: unknown, event: unknown) => void>()
  return {
    source: {
      subscribe(handler) {
        handlers.add(handler)
        return () => {
          handlers.delete(handler)
        }
      },
    },
    emit(session, event) {
      for (const handler of handlers) handler(session, event)
    },
  }
}

function makeService(synthesize: FriendTtsProvider['synthesize'], getAutoSpeak?: () => boolean) {
  const registry = createFriendTtsRegistry()
  registry.register({
    id: 'edge',
    listVoices: async () => [],
    synthesize,
  })
  const router = createFriendTtsRouter({
    registry,
    getConfig: () => ({ provider: 'edge' }),
  })
  const cache = createFriendTtsCache()
  const queue = createFriendTtsQueue()
  const service = createFriendTtsService({
    router,
    cache,
    queue,
    getPreferredProvider: () => 'edge',
    ...(getAutoSpeak === undefined ? {} : { getAutoSpeak }),
  })
  return { service, queue }
}

async function playRaw(
  raw: string,
  options: { autoSpeak?: boolean } = {},
) {
  const synthesize = vi.fn(async (text: string) => ({ audio: Buffer.from(text), mime: 'audio/mpeg' }))
  const autoSpeak = options.autoSpeak !== false
  const { service, queue } = makeService(synthesize, () => autoSpeak)
  const chat = createChatTracker()
  const performance = createPerformanceTracker()
  const sink = createCompanionStageSink({ chat, performance })
  const spoken: string[] = []
  const jobs: Array<Promise<unknown>> = []
  const speaker = createCompanionTtsSpeaker({
    speakSentence: (text) => {
      spoken.push(text)
      const job = service.speak(text, { raw: true, autoSpeak })
      jobs.push(job)
      return job
    },
    getAutoSpeak: () => autoSpeak,
  })
  const fake = createFakeSource()
  const filter = createCompanionSessionFilter()
  const stopStage = subscribeCompanionReplies(fake.source, (delta) => sink.accept(delta), { filter })
  const stopTts = subscribeCompanionReplies(fake.source, (delta) => speaker.accept(delta), { filter })
  const session = companionSession()
  fake.emit(session, { type: 'turn/start', data: { turn: 1 } })
  for (const char of raw) {
    fake.emit(session, {
      type: 'assistant/chunk',
      data: { chunk: { type: 'text-delta', text: char } },
    })
  }
  fake.emit(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  await Promise.all(jobs)
  expect(chat.snapshot().status).toBe(DISPLAY.length > 0 ? 'ready' : 'idle')
  stopStage()
  stopTts()
  speaker.dispose()
  sink.dispose()
  queue.dispose()
  return { synthesize, spoken, chat, performance, queue, sink }
}

describe('companion reply chain (persona → stage → tts)', () => {
  it('strips tags at every character split, drives expressions, and speaks body only', async () => {
    const { synthesize, spoken, chat, performance } = await playRaw(RAW)
    expect(chat.snapshot().assistantText).toBe(DISPLAY)
    expect(chat.snapshot().assistantText).not.toMatch(/\[(?:expr|motion|cue):/u)
    expect(chat.snapshot().typing).toBe(false)
    expect(chat.snapshot().status).toBe('ready')
    expect(spoken).toEqual(['你好世界呀！', '尾巴'])
    expect(spoken.join('')).not.toMatch(/\[(?:expr|motion|cue):/u)
    expect(synthesize.mock.calls.map((call) => call[0])).toEqual(['你好世界呀！', '尾巴'])
    expect(performance.snapshot()).toMatchObject({
      expression: 'happy',
      motionGroup: 'Celebrate',
      cue: 'success',
      lastAction: 'cue',
    })
    const bubble = createBubbleController({ send: async () => undefined })
    bubble.applyChatSnapshot(chat.snapshot())
    expect(bubble.getState().assistantText).toBe(DISPLAY)
    expect(bubble.getState().typing).toBe(false)
  })

  it('does not synthesize when autoSpeak is off', async () => {
    const { synthesize, spoken, chat } = await playRaw(RAW, { autoSpeak: false })
    expect(chat.snapshot().assistantText).toBe(DISPLAY)
    expect(spoken).toEqual([])
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('matches whole-string parse at every split index (exhaustive)', async () => {
    const { chat: baseline } = await playRaw(RAW)
    for (let index = 0; index <= RAW.length; index += 1) {
      const fake = createFakeSource()
      const chat = createChatTracker()
      const performance = createPerformanceTracker()
      const sink = createCompanionStageSink({ chat, performance })
      const spoken: string[] = []
      const speaker = createCompanionTtsSpeaker({
        speakSentence: (text) => {
          spoken.push(text)
        },
      })
      subscribeCompanionReplies(fake.source, (delta) => sink.accept(delta))
      subscribeCompanionReplies(fake.source, (delta) => speaker.accept(delta))
      const session = companionSession()
      const left = RAW.slice(0, index)
      const right = RAW.slice(index)
      fake.emit(session, { type: 'turn/start', data: { turn: 1 } })
      if (left.length > 0) {
        fake.emit(session, {
          type: 'assistant/chunk',
          data: { chunk: { type: 'text-delta', text: left } },
        })
      }
      if (right.length > 0) {
        fake.emit(session, {
          type: 'assistant/chunk',
          data: { chunk: { type: 'text-delta', text: right } },
        })
      }
      fake.emit(session, { type: 'turn/end', data: { turn: 1 } })
      expect(chat.snapshot().assistantText, `split at ${String(index)}`).toBe(
        baseline.snapshot().assistantText,
      )
      expect(spoken.join(''), `split at ${String(index)}`).toBe('你好世界呀！尾巴')
      expect(chat.snapshot().assistantText).not.toMatch(/\[(?:expr|motion|cue):/u)
    }
  })
})
