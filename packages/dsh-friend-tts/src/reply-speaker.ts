/**
 * Companion-reply → sentence queue. Host `apply()` binds this to
 * `subscribeCompanionReplies`. Tags are stripped with
 * {@link createStreamingTtsPreparer} (`StreamingTagParser`) before
 * `service.speak(..., { raw: true })`.
 */

import type { CompanionReplyDelta } from '@wish233/dsh-friend-persona'

import {
  createStreamingTtsPreparer,
  type StreamingTtsPreparer,
} from './prepare.ts'
import type { FriendTtsService, FriendTtsSpeakResult } from './service.ts'

export type CompanionTtsSpeakSentence = (
  text: string,
  sessionId: string,
) => void | Promise<void>

export type CompanionTtsSpeaker = {
  accept(delta: CompanionReplyDelta): void
  spoken(): readonly string[]
  dispose(): void
}

export type CreateCompanionTtsSpeakerOptions = {
  speakSentence: CompanionTtsSpeakSentence
  getAutoSpeak?: () => boolean
  stripStageDirections?: boolean
}

type SessionSpeakState = {
  preparer: StreamingTtsPreparer
}

export function createCompanionTtsSpeaker(
  options: CreateCompanionTtsSpeakerOptions,
): CompanionTtsSpeaker {
  const sessions = new Map<string, SessionSpeakState>()
  const spoken: string[] = []
  let disposed = false

  const stateOf = (sessionId: string): SessionSpeakState => {
    const existing = sessions.get(sessionId)
    if (existing !== undefined) {
      return existing
    }
    const created = { preparer: createPreparer(options) }
    sessions.set(sessionId, created)
    return created
  }

  const enqueue = (sessionId: string, sentences: readonly string[]): void => {
    if (options.getAutoSpeak?.() === false) {
      return
    }
    for (const sentence of sentences) {
      spoken.push(sentence)
      void options.speakSentence(sentence, sessionId)
    }
  }

  return {
    accept(delta) {
      if (disposed) {
        return
      }
      if (delta.reset) {
        sessions.set(delta.sessionId, { preparer: createPreparer(options) })
      }
      const state = stateOf(delta.sessionId)
      if (delta.mode === 'replace' && !delta.reset && delta.rawDelta.length > 0) {
        state.preparer = createPreparer(options)
      }
      if (delta.rawDelta.length > 0) {
        enqueue(delta.sessionId, state.preparer.push(delta.rawDelta).sentences)
      }
      if (delta.done) {
        enqueue(delta.sessionId, state.preparer.flush().sentences)
        sessions.delete(delta.sessionId)
      }
    },
    spoken() {
      return spoken
    },
    dispose() {
      disposed = true
      sessions.clear()
    },
  }
}

export function bindServiceSpeakSentence(
  service: FriendTtsService,
  onResult?: (result: FriendTtsSpeakResult) => void,
): CompanionTtsSpeakSentence {
  return (text, sessionId) => {
    void service.speak(text, { raw: true, sessionId }).then((result) => {
      onResult?.(result)
    })
  }
}

function createPreparer(options: CreateCompanionTtsSpeakerOptions): StreamingTtsPreparer {
  return createStreamingTtsPreparer({
    stripStageDirections: options.stripStageDirections !== false,
  })
}
