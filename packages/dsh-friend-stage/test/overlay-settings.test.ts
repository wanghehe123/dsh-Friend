/**
 * These tests cover settings/core snapshot wiring and the resulting inline host
 * style (left/top/width/height/hidden). jsdom has no layout engine and does not
 * load the overlay stylesheet, so chrome grab targets are not verified here.
 * Real drag-bar height, resize-corner placement, and computed cursors are
 * asserted in `scripts/browser-smoke.mjs` (`assertFloatChromeGeometry`).
 * Do not treat this file as proof that the float is draggable after refresh.
 */
import { describe, expect, it } from 'vitest'

import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared/universal'

import { CORE_ENABLED_FIELD, CORE_SETTINGS_NAMESPACE, readCoreEnabled } from '../src/core-gate.ts'
import { bindCoreSettings, bindOverlaySettings, bindPlaybackSettings, mountFriendStageOverlay } from '../src/overlay.ts'
import {
  createFakeOverlayDocument,
  createFakeOverlayWindow,
  createMemorySettingsScope,
  querySelectorDeep,
} from './helpers/overlay-dom.ts'

describe('mounted overlay follows friend-stage settings', () => {
  it('moves the host when the stage scope notifies a new float rect', () => {
    const document = createFakeOverlayDocument()
    const settings = createMemorySettingsScope({
      floatLeft: 12,
      floatTop: 16,
      floatWidth: 280,
      floatHeight: 360,
    })
    mountFriendStageOverlay({ document, window: createFakeOverlayWindow(), settings })
    const host = document.attached[0]
    expect(host?.style.cssText).toContain('left:12px')

    settings.value.floatLeft = 80
    settings.value.floatTop = 40
    settings.notify()
    expect(host?.style.cssText).toContain('left:80px')
    expect(host?.style.cssText).toContain('top:40px')
  })

  it('does not clobber an in-progress drag with a settings notification', () => {
    const document = createFakeOverlayDocument()
    const settings = createMemorySettingsScope({
      floatLeft: 200,
      floatTop: 200,
      floatWidth: 280,
      floatHeight: 360,
    })
    mountFriendStageOverlay({ document, window: createFakeOverlayWindow(), settings })
    const host = document.attached[0]
    const drag = host === undefined ? null : querySelectorDeep(host, '[data-friend-drag]')
    drag?.dispatch('pointerdown', { clientX: 10, clientY: 10, pointerId: 4 })
    document.dispatch('pointermove', { clientX: 30, clientY: 40, pointerId: 4 })
    const duringDrag = host?.style.cssText

    settings.value.floatLeft = 12
    settings.value.floatTop = 16
    settings.notify()
    expect(host?.style.cssText).toBe(duringDrag)
  })
})

describe('friend-core.enabled gates the float and its iframe', () => {
  it('uses the shared core namespace constant rather than a handwritten string', () => {
    expect(CORE_SETTINGS_NAMESPACE).toBe(FRIEND_SETTINGS_NAMESPACES.core)
    expect(CORE_ENABLED_FIELD).toBe('enabled')
    expect(readCoreEnabled(undefined)).toBe(true)
    expect(readCoreEnabled({ [CORE_ENABLED_FIELD]: false })).toBe(false)
    expect(readCoreEnabled({ [CORE_ENABLED_FIELD]: true })).toBe(true)
  })

  it('hides the host and blanks the pet iframe when the master switch turns off', () => {
    const document = createFakeOverlayDocument()
    const coreSettings = createMemorySettingsScope({ enabled: true })
    mountFriendStageOverlay({
      document,
      window: createFakeOverlayWindow(),
      coreSettings,
    })
    const host = document.attached[0]
    const iframe = host === undefined ? null : querySelectorDeep(host, 'iframe')
    expect(host?.hidden).toBe(false)
    expect(iframe?.getAttribute('src')).toContain('/friend/pet')

    coreSettings.value.enabled = false
    coreSettings.notify()
    expect(host?.hidden).toBe(true)
    expect(iframe?.getAttribute('src')).toBe('about:blank')

    coreSettings.value.enabled = true
    coreSettings.notify()
    expect(host?.hidden).toBe(false)
    expect(iframe?.getAttribute('src')).toContain('/friend/pet')
  })

  it('keeps the iframe loaded when only floatHidden is set', () => {
    const document = createFakeOverlayDocument()
    const settings = createMemorySettingsScope({
      floatLeft: 12,
      floatTop: 16,
      floatWidth: 280,
      floatHeight: 360,
      floatHidden: false,
    })
    const coreSettings = createMemorySettingsScope({ enabled: true })
    mountFriendStageOverlay({
      document,
      window: createFakeOverlayWindow(),
      settings,
      coreSettings,
    })
    const host = document.attached[0]
    const iframe = host === undefined ? null : querySelectorDeep(host, 'iframe')

    settings.value.floatHidden = true
    settings.notify()
    expect(host?.hidden).toBe(true)
    expect(iframe?.getAttribute('src')).toContain('/friend/pet')
  })

  it('binds the core namespace through the settingsScope binder', () => {
    const bound: string[] = []
    const scope = createMemorySettingsScope({ enabled: true })
    const binder = {
      bind(spec: { namespace: string }) {
        bound.push(spec.namespace)
        return scope
      },
    }
    expect(bindCoreSettings(binder).getSnapshot().value).toEqual({ enabled: true })
    expect(bindOverlaySettings(binder).getSnapshot().value).toEqual({ enabled: true })
    expect(bindPlaybackSettings(binder).getSnapshot().value).toEqual({ enabled: true })
    expect(bound).toEqual([
      FRIEND_SETTINGS_NAMESPACES.core,
      FRIEND_SETTINGS_NAMESPACES.stage,
      FRIEND_SETTINGS_NAMESPACES.tts,
    ])
  })
})
