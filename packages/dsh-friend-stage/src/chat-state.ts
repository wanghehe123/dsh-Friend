/**
 * Reentrant companion-chat snapshots. EventSource / pollers must be able to
 * restore the bubble from one GET without replaying deltas.
 */

export type ChatStatus = 'idle' | 'sending' | 'typing' | 'ready' | 'error'

export type ChatSnapshot = Readonly<{
  seq: number
  status: ChatStatus
  userText: string
  assistantText: string
  typing: boolean
  sessionId: string
  sent: boolean
  error: string
}>

export const IDLE_CHAT: ChatSnapshot = {
  seq: 0,
  status: 'idle',
  userText: '',
  assistantText: '',
  typing: false,
  sessionId: '',
  sent: false,
  error: '',
}

export type ChatListener = (snapshot: ChatSnapshot) => void

export type ChatTracker = {
  snapshot(): ChatSnapshot
  beginSend(userText: string): ChatSnapshot
  markSent(sessionId: string): ChatSnapshot
  markFailed(error: string): ChatSnapshot
  applyAssistant(text: string, mode?: 'replace' | 'append'): ChatSnapshot
  finish(): ChatSnapshot
  subscribe(listener: ChatListener): () => void
}

export function createChatTracker(initial: ChatSnapshot = IDLE_CHAT): ChatTracker {
  let current = initial
  const listeners = new Set<ChatListener>()

  const commit = (next: Omit<ChatSnapshot, 'seq'>): ChatSnapshot => {
    current = { ...next, seq: current.seq + 1 }
    for (const listener of listeners) listener(current)
    return current
  }

  return {
    snapshot() {
      return current
    },
    beginSend(userText) {
      return commit({
        status: 'sending',
        userText,
        assistantText: '',
        typing: true,
        sessionId: current.sessionId,
        sent: false,
        error: '',
      })
    },
    markSent(sessionId) {
      return commit({
        ...current,
        status: 'typing',
        sessionId,
        sent: true,
        typing: true,
        error: '',
      })
    },
    markFailed(error) {
      return commit({
        ...current,
        status: 'error',
        sent: false,
        typing: false,
        error,
      })
    },
    applyAssistant(text, mode = 'replace') {
      const assistantText = mode === 'append' ? `${current.assistantText}${text}` : text
      return commit({
        ...current,
        status: 'typing',
        assistantText,
        typing: true,
        error: '',
      })
    },
    finish() {
      return commit({
        ...current,
        status: current.assistantText.length > 0 ? 'ready' : 'idle',
        typing: false,
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

let shared = createChatTracker()

export function getSharedChatTracker(): ChatTracker {
  return shared
}

export function resetSharedChatTracker(): void {
  shared = createChatTracker()
}
