/**
 * These tests cover settings/core snapshot wiring and the resulting inline host
 * style (left/top/width/height/hidden). jsdom has no layout engine and does not
 * load the overlay stylesheet, so chrome grab targets are not verified here.
 * Real drag-bar height, resize-corner placement, and computed cursors are
 * asserted in `scripts/browser-smoke.mjs` (`assertFloatChromeGeometry`).
 * Do not treat this file as proof that the float is draggable after refresh.
 */
import { describe, expect, it, vi } from 'vitest'

import { FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared/universal'

import {
  CORE_ENABLED_FIELD,
  CORE_FLOAT_ENABLED_FIELD,
  CORE_SETTINGS_NAMESPACE,
  readCoreEnabled,
  readCoreStageVisible,
} from '../src/core-gate.ts'
import {
  bindCoreSettings,
  bindOverlaySettings,
  bindPlaybackSettings,
  FRIEND_CORE_STAGE_EVENT,
  mountFriendStageOverlay,
  PET_EMBED_SRC,
  PET_IFRAME_IDLE_SRC,
  SETTINGS_SNAPSHOT_POLL_MS,
} from '../src/overlay.ts'
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
    expect(readCoreStageVisible({ [CORE_ENABLED_FIELD]: true, [CORE_FLOAT_ENABLED_FIELD]: false })).toBe(false)
  })

  it('hides the host when the config-center float toggle turns off', async () => {
    const document = createFakeOverlayDocument()
    const windowLike = createFakeOverlayWindow()
    const live = { enabled: true, floatEnabled: true }
    const handle = mountFriendStageOverlay({
      document,
      window: windowLike,
      fetch: snapshotFetch(live),
    })
    const host = document.attached[0]
    await vi.waitFor(() => {
      expect(host?.hidden).toBe(false)
    })

    windowLike.dispatchEvent({
      type: FRIEND_CORE_STAGE_EVENT,
      detail: { enabled: true, floatEnabled: false },
    })
    expect(host?.hidden).toBe(true)
    expect(host?.style.cssText).toContain('display:none')
    const iframe = host === undefined ? null : querySelectorDeep(host, 'iframe')
    expect(iframe?.getAttribute('src')).toBe(PET_IFRAME_IDLE_SRC)
    handle.dispose()
  })

  it('hides the host and blanks the pet iframe when the master switch turns off', async () => {
    const document = createFakeOverlayDocument()
    const live = { enabled: true, floatEnabled: true }
    const windowLike = createFakeOverlayWindow()
    const handle = mountFriendStageOverlay({
      document,
      window: windowLike,
      fetch: snapshotFetch(live),
    })
    const host = document.attached[0]
    const iframe = host === undefined ? null : querySelectorDeep(host, 'iframe')
    await vi.waitFor(() => {
      expect(host?.hidden).toBe(false)
      expect(iframe?.getAttribute('src')).toContain('/friend/pet')
    })

    windowLike.dispatchEvent({
      type: FRIEND_CORE_STAGE_EVENT,
      detail: { enabled: false, floatEnabled: true },
    })
    expect(host?.hidden).toBe(true)
    expect(host?.style.cssText).toContain('display:none')
    expect(iframe?.getAttribute('src')).toBe(PET_IFRAME_IDLE_SRC)

    windowLike.dispatchEvent({
      type: FRIEND_CORE_STAGE_EVENT,
      detail: { enabled: true, floatEnabled: true },
    })
    expect(host?.hidden).toBe(false)
    expect(iframe?.getAttribute('src')).toContain('/friend/pet')
    handle.dispose()
  })

  it('keeps the iframe loaded when only floatHidden is set', async () => {
    const document = createFakeOverlayDocument()
    const settings = createMemorySettingsScope({
      floatLeft: 12,
      floatTop: 16,
      floatWidth: 280,
      floatHeight: 360,
      floatHidden: false,
    })
    const handle = mountFriendStageOverlay({
      document,
      window: createFakeOverlayWindow(),
      settings,
      fetch: snapshotFetch({ enabled: true, floatEnabled: true }),
    })
    const host = document.attached[0]
    const iframe = host === undefined ? null : querySelectorDeep(host, 'iframe')
    await vi.waitFor(() => {
      expect(iframe?.getAttribute('src')).toContain('/friend/pet')
    })

    settings.value.floatHidden = true
    settings.notify()
    expect(host?.hidden).toBe(true)
    expect(iframe?.getAttribute('src')).toContain('/friend/pet')
    handle.dispose()
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

  it('hides the float when the host snapshot has enabled and floatEnabled false even if settingsScope is default-on', async () => {
    const document = createFakeOverlayDocument()
    const coreSettings = createMemorySettingsScope({ enabled: true, floatEnabled: true })
    const handle = mountFriendStageOverlay({
      document,
      window: createFakeOverlayWindow(),
      coreSettings,
      fetch: snapshotFetch({ enabled: false, floatEnabled: false }),
    })
    const host = document.attached[0]
    const iframe = host === undefined ? null : querySelectorDeep(host, 'iframe')
    await vi.waitFor(() => {
      expect(host?.hidden).toBe(true)
      expect(iframe?.getAttribute('src')).toBe(PET_IFRAME_IDLE_SRC)
    })
    handle.dispose()
  })

  it('hides after Save when the snapshot turns off without a settingsScope notification', async () => {
    vi.useFakeTimers()
    const document = createFakeOverlayDocument()
    const live = { enabled: true, floatEnabled: true }
    const coreSettings = createMemorySettingsScope({ ...live })
    const handle = mountFriendStageOverlay({
      document,
      window: createFakeOverlayWindow(),
      coreSettings,
      fetch: snapshotFetch(live),
    })
    await Promise.resolve()
    await Promise.resolve()
    const host = document.attached[0]
    const iframe = host === undefined ? null : querySelectorDeep(host, 'iframe')
    expect(host?.hidden).toBe(false)
    expect(iframe?.getAttribute('src')).toBe(PET_EMBED_SRC)

    live.enabled = false
    live.floatEnabled = false
    await vi.advanceTimersByTimeAsync(SETTINGS_SNAPSHOT_POLL_MS)
    await Promise.resolve()
    expect(host?.hidden).toBe(true)
    expect(iframe?.getAttribute('src')).toBe(PET_IFRAME_IDLE_SRC)
    handle.dispose()
    vi.useRealTimers()
  })

  it('hides immediately when the plugin card broadcasts core-stage off, including inline display:none', async () => {
    const document = createFakeOverlayDocument()
    const windowLike = createFakeOverlayWindow()
    const handle = mountFriendStageOverlay({
      document,
      window: windowLike,
      coreSettings: createMemorySettingsScope({ enabled: true, floatEnabled: true }),
      fetch: snapshotFetch({ enabled: true, floatEnabled: true }),
    })
    const host = document.attached[0]
    const iframe = host === undefined ? null : querySelectorDeep(host, 'iframe')
    await vi.waitFor(() => {
      expect(host?.hidden).toBe(false)
    })

    windowLike.dispatchEvent({
      type: FRIEND_CORE_STAGE_EVENT,
      detail: { enabled: false, floatEnabled: false },
    })
    expect(host?.hidden).toBe(true)
    expect(host?.style.cssText).toContain('display:none')
    expect(iframe?.getAttribute('src')).toBe(PET_IFRAME_IDLE_SRC)
    handle.dispose()
  })

  it('stays hidden when settingsScope is default-on and the snapshot request fails', async () => {
    const document = createFakeOverlayDocument()
    const coreSettings = createMemorySettingsScope({ enabled: true, floatEnabled: true })
    const handle = mountFriendStageOverlay({
      document,
      window: createFakeOverlayWindow(),
      coreSettings,
      fetch: async () => ({ ok: false, json: async () => ({}) }),
    })
    const host = document.attached[0]
    const iframe = host === undefined ? null : querySelectorDeep(host, 'iframe')
    await flushOverlayGate()
    coreSettings.notify()
    expect(host?.hidden).toBe(true)
    expect(host?.style.cssText).toContain('display:none')
    expect(iframe?.getAttribute('src')).toBe(PET_IFRAME_IDLE_SRC)
    handle.dispose()
  })
})

async function flushOverlayGate(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function snapshotFetch(core: Record<string, unknown>) {
  return async (input: string) => {
    if (input === '/friend/settings/snapshot') {
      return {
        ok: true,
        json: async () => ({ core: { muted: false, ...core } }),
      }
    }
    return { ok: false, json: async () => ({}) }
  }
}
