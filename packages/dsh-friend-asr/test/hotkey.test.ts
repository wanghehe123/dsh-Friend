import { describe, expect, it, vi } from 'vitest'

import {
  createAsrHotkeyController,
  evaluateAsrHotkey,
  formatAsrHotkey,
  isTextEntryTarget,
  parseAsrHotkey,
  type AsrHotkeyRejected,
  type AsrHotkeyStore,
} from '../src/hotkey.ts'
import { altS, createHotkeyTarget, inputTarget, keyEvent, textareaTarget, type TestKeyEvent } from './helpers/keyboard.ts'

function memoryStore(initial?: string): AsrHotkeyStore & { writes: string[] } {
  let value = initial
  const writes: string[] = []
  return {
    writes,
    get() {
      return value
    },
    set(spec) {
      value = spec
      writes.push(spec)
    },
  }
}

describe('hotkey parse / evaluate', () => {
  it('treats Alt+S as the default-shaped chord', () => {
    const parsed = parseAsrHotkey('Alt+S')
    expect(parsed).toEqual({ alt: true, ctrl: false, meta: false, shift: false, key: 's' })
    if (parsed === undefined) {
      return
    }
    expect(formatAsrHotkey(parsed)).toBe('Alt+S')
    expect(evaluateAsrHotkey('Alt+S').ok).toBe(true)
  })

  it('rejects F5 with a refresh reason (browser blacklist)', () => {
    const decision = evaluateAsrHotkey('F5')
    expect(decision.ok).toBe(false)
    if (decision.ok) {
      return
    }
    expect(decision.category).toBe('browser')
    expect(decision.reason).toMatch(/刷新|F5/)
  })

  it('rejects Ctrl+W as a close-tab chord', () => {
    const decision = evaluateAsrHotkey('Ctrl+W')
    expect(decision.ok).toBe(false)
    if (decision.ok) {
      return
    }
    expect(decision.reason).toMatch(/关闭/)
  })

  it('rejects Ctrl+Enter as a dsh send-message chord', () => {
    const decision = evaluateAsrHotkey('Ctrl+Enter')
    expect(decision.ok).toBe(false)
    if (decision.ok) {
      return
    }
    expect(decision.category).toBe('dsh')
    expect(decision.reason).toMatch(/发送/)
  })

  it('rejects a bare letter so typing in an input cannot be stolen', () => {
    const decision = evaluateAsrHotkey('S')
    expect(decision.ok).toBe(false)
    if (decision.ok) {
      return
    }
    expect(decision.category).toBe('invalid')
    expect(decision.reason).toMatch(/Alt|Ctrl|Meta/)
  })

  it('accepts Alt+Q', () => {
    const decision = evaluateAsrHotkey('Alt+Q')
    expect(decision.ok).toBe(true)
    if (!decision.ok) {
      return
    }
    expect(decision.spec).toBe('Alt+Q')
  })
})

describe('hotkey controller', () => {
  it('registers capture-phase listeners and fires on Alt+S', () => {
    const target = createHotkeyTarget()
    const downs: number[] = []
    const ups: number[] = []
    const controller = createAsrHotkeyController({
      target: target.target,
      onDown: () => {
        downs.push(1)
      },
      onUp: () => {
        ups.push(1)
      },
    })
    controller.attach()
    expect(target.capture.keydown).toBe(true)
    expect(target.capture.keyup).toBe(true)

    const down = altS('keydown')
    target.dispatch(down)
    expect(down.defaultPrevented).toBe(true)
    expect(downs).toHaveLength(1)

    const up = altS('keyup')
    target.dispatch(up)
    expect(up.defaultPrevented).toBe(true)
    expect(ups).toHaveLength(1)

    controller.dispose()
  })

  it('still fires hold-to-talk when a textarea is focused, without swallowing other keys', () => {
    const controller = createAsrHotkeyController({
      onDown: () => {
        fired.push('down')
      },
    })
    const fired: string[] = []

    expect(isTextEntryTarget(textareaTarget)).toBe(true)

    const typed: TestKeyEvent[] = []
    for (const letter of ['h', 'e', 'l', 'l', 'o']) {
      const event = keyEvent({ type: 'keydown', key: letter, target: textareaTarget })
      controller.handleEvent(event)
      typed.push(event)
    }
    expect(typed.every((event) => !event.defaultPrevented)).toBe(true)
    expect(fired).toEqual([])

    const chord = altS('keydown', { target: textareaTarget })
    controller.handleEvent(chord)
    expect(chord.defaultPrevented).toBe(true)
    expect(fired).toEqual(['down'])

    const ess = keyEvent({ type: 'keydown', key: 's', target: inputTarget })
    controller.handleEvent(ess)
    expect(ess.defaultPrevented).toBe(false)
    expect(fired).toEqual(['down'])
  })

  it('ignores key-repeat on the bound chord', () => {
    const downs = vi.fn()
    const controller = createAsrHotkeyController({ onDown: downs })
    controller.handleEvent(altS('keydown'))
    controller.handleEvent(altS('keydown', { repeat: true }))
    expect(downs).toHaveBeenCalledOnce()
  })

  it('records a new chord, persists it, and uses it immediately', () => {
    const store = memoryStore()
    const downs = vi.fn()
    const controller = createAsrHotkeyController({ store, onDown: downs })
    expect(controller.getSpec()).toBe('Alt+S')

    controller.startRecording()
    const captured = keyEvent({ type: 'keydown', key: 'q', altKey: true })
    controller.handleEvent(captured)
    expect(captured.defaultPrevented).toBe(true)
    expect(controller.recording()).toBe(false)
    expect(controller.getSpec()).toBe('Alt+Q')
    expect(store.writes).toEqual(['Alt+Q'])

    controller.handleEvent(altS('keydown'))
    expect(downs).not.toHaveBeenCalled()
    controller.handleEvent(keyEvent({ type: 'keydown', key: 'q', altKey: true }))
    expect(downs).toHaveBeenCalledOnce()
  })

  it('Esc cancels recording and keeps the previous chord', () => {
    const cancelled = vi.fn()
    const controller = createAsrHotkeyController({ onRecordCancel: cancelled })
    controller.startRecording()
    const esc = keyEvent({ type: 'keydown', key: 'Escape' })
    controller.handleEvent(esc)
    expect(esc.defaultPrevented).toBe(true)
    expect(controller.recording()).toBe(false)
    expect(controller.getSpec()).toBe('Alt+S')
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('rejects a blacklisted chord while recording and keeps listening for another', () => {
    const conflicts: AsrHotkeyRejected[] = []
    const controller = createAsrHotkeyController({
      onConflict: (decision) => {
        conflicts.push(decision)
      },
    })
    controller.startRecording()
    controller.handleEvent(keyEvent({ type: 'keydown', key: 'F5' }))
    expect(controller.recording()).toBe(true)
    expect(controller.getSpec()).toBe('Alt+S')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.reason).toMatch(/刷新|F5/)
  })

  it('setHotkey refuses Ctrl+W and does not persist', () => {
    const store = memoryStore('Alt+S')
    const conflicts: string[] = []
    const controller = createAsrHotkeyController({
      store,
      onConflict: (decision) => {
        conflicts.push(decision.reason)
      },
    })
    const decision = controller.setHotkey('Ctrl+W')
    expect(decision.ok).toBe(false)
    expect(controller.getSpec()).toBe('Alt+S')
    expect(store.writes).toEqual([])
    expect(conflicts[0]).toMatch(/关闭/)
  })

  it('reloads a persisted Alt+Q from the store', () => {
    const store = memoryStore('Alt+Q')
    const downs = vi.fn()
    const controller = createAsrHotkeyController({ store, onDown: downs })
    expect(controller.getSpec()).toBe('Alt+Q')
    controller.handleEvent(keyEvent({ type: 'keydown', key: 'q', altKey: true }))
    expect(downs).toHaveBeenCalledOnce()
  })
})
