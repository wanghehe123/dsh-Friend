import type { AsrHotkeyTarget, AsrKeyEventLike } from '../../src/hotkey.ts'

export type TestKeyInit = {
  type?: 'keydown' | 'keyup'
  key: string
  code?: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  repeat?: boolean
  isComposing?: boolean
  target?: unknown
}

export type TestKeyEvent = AsrKeyEventLike & {
  defaultPrevented: boolean
  propagationStopped: boolean
}

export function keyEvent(init: TestKeyInit): TestKeyEvent {
  let defaultPrevented = false
  let propagationStopped = false
  const event: TestKeyEvent = {
    type: init.type ?? 'keydown',
    key: init.key,
    ...(init.code !== undefined ? { code: init.code } : {}),
    altKey: init.altKey === true,
    ctrlKey: init.ctrlKey === true,
    metaKey: init.metaKey === true,
    shiftKey: init.shiftKey === true,
    repeat: init.repeat === true,
    isComposing: init.isComposing === true,
    ...(init.target !== undefined ? { target: init.target } : {}),
    preventDefault() {
      defaultPrevented = true
    },
    stopPropagation() {
      propagationStopped = true
    },
    get defaultPrevented() {
      return defaultPrevented
    },
    get propagationStopped() {
      return propagationStopped
    },
  }
  return event
}

export function altS(type: 'keydown' | 'keyup' = 'keydown', extra: Omit<TestKeyInit, 'key' | 'type'> = {}): TestKeyEvent {
  return keyEvent({ type, key: 's', altKey: true, ...extra })
}

export function createHotkeyTarget(): {
  target: AsrHotkeyTarget
  capture: { keydown?: boolean; keyup?: boolean }
  dispatch(event: AsrKeyEventLike): void
} {
  const listeners: Record<string, Set<(event: AsrKeyEventLike) => void>> = {
    keydown: new Set(),
    keyup: new Set(),
  }
  const capture: { keydown?: boolean; keyup?: boolean } = {}
  const target: AsrHotkeyTarget = {
    addEventListener(type, listener, options) {
      const set = listeners[type]
      set?.add(listener)
      const useCapture = options === true || (typeof options === 'object' && options.capture === true)
      if (type === 'keydown' || type === 'keyup') {
        capture[type] = useCapture
      }
    },
    removeEventListener(type, listener) {
      listeners[type]?.delete(listener)
    },
  }
  return {
    target,
    capture,
    dispatch(event) {
      const type = event.type === 'keyup' ? 'keyup' : 'keydown'
      for (const listener of listeners[type] ?? []) {
        listener(event)
      }
    },
  }
}

export const textareaTarget = { tagName: 'TEXTAREA', isContentEditable: false }
export const inputTarget = { tagName: 'INPUT', isContentEditable: false }
