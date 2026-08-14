import { DEFAULT_BUBBLE_TIMEOUT_MS } from './live2d/stage-settings.ts'
import type { ChatSnapshot } from './chat-state.ts'

export type BubbleView = Readonly<{
  open: boolean
  input: string
  assistantText: string
  typing: boolean
  error: string
}>

export type BubbleSend = (text: string) => Promise<void>

export type BubbleController = {
  getState(): BubbleView
  setInput(value: string): void
  submit(): Promise<void>
  applyChatSnapshot(snapshot: Pick<ChatSnapshot, 'assistantText' | 'typing' | 'error' | 'status'>): void
  dismiss(): void
  tick(now: number): void
  subscribe(listener: () => void): () => void
}

export type BubbleControllerOptions = Readonly<{
  send: BubbleSend
  timeoutMs?: number
  now?: () => number
}>

const EMPTY: BubbleView = {
  open: false,
  input: '',
  assistantText: '',
  typing: false,
  error: '',
}

export function createBubbleController(options: BubbleControllerOptions): BubbleController {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BUBBLE_TIMEOUT_MS
  const now = options.now ?? Date.now
  let state: BubbleView = EMPTY
  let hideAt: number | undefined
  const listeners = new Set<() => void>()

  const emit = (next: BubbleView): void => {
    state = next
    for (const listener of listeners) listener()
  }

  const scheduleHide = (): void => {
    hideAt = now() + timeoutMs
  }

  return {
    getState() {
      return state
    },
    setInput(value) {
      emit({ ...state, input: value })
    },
    async submit() {
      const text = state.input.trim()
      if (text.length === 0) return
      emit({
        open: true,
        input: '',
        assistantText: '',
        typing: true,
        error: '',
      })
      hideAt = undefined
      try {
        await options.send(text)
      } catch (error) {
        emit({
          ...state,
          typing: false,
          error: error instanceof Error ? error.message : String(error),
        })
        scheduleHide()
      }
    },
    applyChatSnapshot(snapshot) {
      const assistantText = snapshot.assistantText
      const typing = snapshot.typing || snapshot.status === 'sending' || snapshot.status === 'typing'
      const error = snapshot.error
      const hasContent = typing || assistantText.length > 0 || error.length > 0
      if (!hasContent) {
        return
      }
      const unchanged = (
        state.open
        && state.assistantText === assistantText
        && state.typing === typing
        && state.error === error
      )
      emit({
        open: true,
        input: state.input,
        assistantText,
        typing,
        error,
      })
      if (unchanged) {
        return
      }
      if (typing) {
        hideAt = undefined
        return
      }
      scheduleHide()
    },
    dismiss() {
      hideAt = undefined
      emit({ ...state, open: false, typing: false })
    },
    tick(current) {
      if (hideAt !== undefined && current >= hideAt) {
        hideAt = undefined
        emit({ ...state, open: false, typing: false })
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function handleBubbleKeydown(
  event: { key: string; shiftKey: boolean; preventDefault(): void },
  controller: BubbleController,
): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void controller.submit()
  }
}
