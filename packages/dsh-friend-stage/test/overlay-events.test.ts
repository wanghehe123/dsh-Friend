/**
 * These tests cover event wiring and drag/resize *math* (inline left/top/width/height
 * on the host). jsdom has no layout engine and does not load the overlay stylesheet,
 * so a 0-height drag bar or four handles stacked in static flow still passes here.
 * Real grab-ability and corner geometry are asserted in
 * `scripts/browser-smoke.mjs` (`assertFloatChromeGeometry`) via getBoundingClientRect
 * + computed cursor. Do not treat this file as proof that drag/resize works in a browser.
 */
import { describe, expect, it, vi } from 'vitest'

import { mountFriendStageOverlay } from '../src/overlay.ts'
import {
  createFakeOverlayDocument,
  createFakeOverlayWindow,
  createMemorySettingsScope,
  querySelectorDeep,
} from './helpers/overlay-dom.ts'

describe('float overlay pointer and menu wiring', () => {
  it('captures the pointer on drag-handle pointerdown and moves the host through document listeners', () => {
    const document = createFakeOverlayDocument()
    const windowLike = createFakeOverlayWindow()
    const settings = createMemorySettingsScope({
      floatLeft: 900,
      floatTop: 400,
      floatWidth: 280,
      floatHeight: 360,
    })

    mountFriendStageOverlay({ document, window: windowLike, settings })

    const host = document.attached[0]
    expect(host, 'overlay host must be attached').toBeDefined()
    const drag = host === undefined ? null : querySelectorDeep(host, '[data-friend-drag]')
    expect(drag, 'drag handle must exist and listen for pointerdown').toBeTruthy()
    expect(drag?.listeners.get('pointerdown')?.length ?? 0).toBeGreaterThan(0)
    expect(document.listeners.get('pointermove')?.length ?? 0).toBeGreaterThan(0)
    expect(document.listeners.get('pointerup')?.length ?? 0).toBeGreaterThan(0)

    drag?.dispatch('pointerdown', { button: 0, clientX: 100, clientY: 100, pointerId: 7 })
    expect(drag?.capturedPointerId).toBe(7)

    document.dispatch('pointermove', { clientX: 40, clientY: 20, pointerId: 7 })
    expect(host?.style.cssText).toContain('left:840px')
    expect(host?.style.cssText).toContain('top:320px')

    document.dispatch('pointerup', { pointerId: 7 })
    expect(drag?.capturedPointerId).toBeUndefined()
  })

  it('ignores right-button pointerdown on the drag handle', () => {
    const document = createFakeOverlayDocument()
    mountFriendStageOverlay({ document, window: createFakeOverlayWindow() })
    const host = document.attached[0]
    const drag = host === undefined ? null : querySelectorDeep(host, '[data-friend-drag]')
    const before = host?.style.cssText

    drag?.dispatch('pointerdown', { button: 2, clientX: 10, clientY: 10, pointerId: 1 })
    document.dispatch('pointermove', { clientX: 400, clientY: 400, pointerId: 1 })
    expect(host?.style.cssText).toBe(before)
    expect(drag?.capturedPointerId).toBeUndefined()
  })

  it('starts a corner resize from the handle pointerdown listener', () => {
    const document = createFakeOverlayDocument()
    mountFriendStageOverlay({
      document,
      window: createFakeOverlayWindow(),
      settings: createMemorySettingsScope({
        floatLeft: 200,
        floatTop: 200,
        floatWidth: 280,
        floatHeight: 360,
      }),
    })
    const host = document.attached[0]
    const handle = host === undefined ? null : querySelectorDeep(host, '[data-resize="bottom-right"]')
    expect(handle?.listeners.get('pointerdown')?.length ?? 0).toBeGreaterThan(0)

    handle?.dispatch('pointerdown', { clientX: 480, clientY: 560, pointerId: 3 })
    expect(handle?.capturedPointerId).toBe(3)
    document.dispatch('pointermove', { clientX: 500, clientY: 600, pointerId: 3 })
    expect(host?.style.cssText).toContain('width:300px')
    expect(host?.style.cssText).toContain('height:400px')
  })

  it('toggles the context menu from the chrome contextmenu listener', () => {
    const document = createFakeOverlayDocument()
    mountFriendStageOverlay({ document, window: createFakeOverlayWindow() })
    const host = document.attached[0]
    expect(host).toBeDefined()
    const chrome = host?.children[0]
    expect(chrome?.listeners.get('contextmenu')?.length ?? 0).toBeGreaterThan(0)
    const menu = host === undefined ? null : querySelectorDeep(host, '[data-friend-menu]')
    expect(menu?.hidden).toBe(true)

    const preventDefault = vi.fn()
    chrome?.dispatch('contextmenu', { preventDefault, clientX: 0, clientY: 0 })
    expect(preventDefault).toHaveBeenCalled()
    expect(menu?.hidden).toBe(false)
  })

  it('writes the TTS mute field and dispatches a real mute event', async () => {
    const document = createFakeOverlayDocument()
    const windowLike = createFakeOverlayWindow()
    const playback = createMemorySettingsScope({ muted: false })
    const settings = createMemorySettingsScope({ floatMuted: false })
    const stopped: string[] = []
    ;(globalThis as { __DSH_FRIEND_TTS__?: { stopAll(): void } }).__DSH_FRIEND_TTS__ = {
      stopAll() {
        stopped.push('audio')
      },
    }
    mountFriendStageOverlay({
      document,
      window: windowLike,
      settings,
      playbackSettings: playback,
      fetch: async () => ({ ok: false, json: async () => ({}) }),
    })
    const host = document.attached[0]
    const mute = host === undefined ? null : querySelectorDeep(host, '[data-action="mute"]')
    expect(mute, 'mute button missing').toBeTruthy()
    mute?.dispatch('click', { clientX: 0, clientY: 0 })
    await Promise.resolve()
    expect(playback.value.muted).toBe(true)
    expect(settings.value.floatMuted).toBe(true)
    expect(windowLike.events).toContain('dsh-friend:mute')
    expect(stopped).toContain('audio')
    expect(mute?.textContent).toBe('取消静音')
    delete (globalThis as { __DSH_FRIEND_TTS__?: { stopAll(): void } }).__DSH_FRIEND_TTS__
  })

  it('delegates the microphone to the pet iframe and offers a desktop popout', () => {
    const document = createFakeOverlayDocument()
    mountFriendStageOverlay({ document, window: createFakeOverlayWindow() })
    const host = document.attached[0]
    const iframe = host === undefined ? null : querySelectorDeep(host, 'iframe')
    expect(iframe?.getAttribute('allow')).toBe('microphone; autoplay')
    expect(host === undefined ? null : querySelectorDeep(host, '[data-action="popout"]'), 'popout button missing').toBeTruthy()
  })

  it('opens the friend config hash from the float settings button', () => {
    const document = createFakeOverlayDocument()
    const windowLike = createFakeOverlayWindow()
    mountFriendStageOverlay({ document, window: windowLike })
    const host = document.attached[0]
    const settings = host === undefined ? null : querySelectorDeep(host, '[data-action="settings"]')
    expect(settings, 'settings button missing').toBeTruthy()
    settings?.dispatch('click', { clientX: 0, clientY: 0 })
    expect(windowLike.events).toContain('dsh-friend:open-settings')
    expect(windowLike.assigned).toContain('#/friend/config/model')
  })

  it('releases document listeners on dispose so a later move cannot drag', () => {
    const document = createFakeOverlayDocument()
    const handle = mountFriendStageOverlay({
      document,
      window: createFakeOverlayWindow(),
      settings: createMemorySettingsScope({
        floatLeft: 100,
        floatTop: 100,
        floatWidth: 280,
        floatHeight: 360,
      }),
    })
    const host = document.attached[0]
    const drag = host === undefined ? null : querySelectorDeep(host, '[data-friend-drag]')
    drag?.dispatch('pointerdown', { clientX: 10, clientY: 10, pointerId: 2 })
    handle.dispose()
    expect(document.listeners.get('pointermove')?.length ?? 0).toBe(0)
    expect(document.listeners.get('pointerup')?.length ?? 0).toBe(0)
    const afterDispose = host?.style.cssText
    document.dispatch('pointermove', { clientX: 80, clientY: 80, pointerId: 2 })
    expect(host?.style.cssText).toBe(afterDispose)
  })
})
