/**
 * Companion-reply → bubble + stage. Host `apply()` binds this to
 * `subscribeCompanionReplies`. Display text is the streaming strip from
 * {@link StreamingTagParser}; applied tag events drive the performance
 * tracker. Raw protocol tags never enter {@link ChatTracker}.
 */

import type { CompanionReplyDelta } from '@wishp3/dsh-friend-persona'

import type { ChatTracker } from './chat-state.ts'
import { applyStageTagEvents, type PerformanceTracker } from './performance-state.ts'
import { StreamingTagParser } from './tag-parser.ts'

export type CompanionStageSink = {
  accept(delta: CompanionReplyDelta): void
  displayText(): string
  dispose(): void
}

export type CreateCompanionStageSinkOptions = {
  chat: ChatTracker
  performance: PerformanceTracker
}

type SessionViewState = {
  parser: StreamingTagParser
  display: string
}

export function createCompanionStageSink(
  options: CreateCompanionStageSinkOptions,
): CompanionStageSink {
  const sessions = new Map<string, SessionViewState>()
  let lastDisplay = ''
  let disposed = false

  const stateOf = (sessionId: string): SessionViewState => {
    const existing = sessions.get(sessionId)
    if (existing !== undefined) {
      return existing
    }
    const created = { parser: new StreamingTagParser(), display: '' }
    sessions.set(sessionId, created)
    return created
  }

  const publish = (state: SessionViewState): void => {
    lastDisplay = state.display
    options.chat.applyAssistant(state.display, 'replace')
  }

  return {
    accept(delta) {
      if (disposed) {
        return
      }
      if (delta.reset) {
        sessions.set(delta.sessionId, { parser: new StreamingTagParser(), display: '' })
        lastDisplay = ''
        options.chat.applyAssistant('', 'replace')
      }
      const state = stateOf(delta.sessionId)
      if (delta.mode === 'replace' && !delta.reset && delta.rawDelta.length > 0) {
        state.parser = new StreamingTagParser()
        state.display = ''
      }
      if (delta.rawDelta.length > 0) {
        const parsed = state.parser.push(delta.rawDelta)
        state.display += parsed.displayText
        applyStageTagEvents(options.performance, parsed.events)
        publish(state)
      }
      if (delta.done) {
        const flushed = state.parser.flush()
        state.display += flushed.displayText
        applyStageTagEvents(options.performance, flushed.events)
        if (state.display.length > 0) {
          publish(state)
        }
        options.chat.finish()
        sessions.delete(delta.sessionId)
      }
    },
    displayText() {
      return lastDisplay
    },
    dispose() {
      disposed = true
      sessions.clear()
    },
  }
}
