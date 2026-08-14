import { afterEach, describe, expect, it, vi } from 'vitest'

import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared/universal'

import { startSettingsClient } from '../src/client-register.ts'
import { inject, name } from '../src/client-meta.ts'
import type { OverlayWriters } from '../src/client-ui/ConfigOverlay.ts'
import {
  FRIEND_SETTINGS_GENERAL_ITEM_SLOT,
  FRIEND_SETTINGS_PATCH_PATH,
  FRIEND_SETTINGS_PLUGIN_ITEM_ID,
  FRIEND_SETTINGS_PLUGIN_ITEM_ORDER,
  FRIEND_SETTINGS_PLUGIN_ITEM_SLOT,
  FRIEND_SETTINGS_SECTION_ID,
  FRIEND_SETTINGS_SECTION_SLOT,
  FRIEND_SETTINGS_SNAPSHOT_PATH,
} from '../src/paths.ts'
import { projectDocuments } from '../src/project.ts'

const previousFetch = (globalThis as { fetch?: typeof fetch }).fetch

afterEach(() => {
  if (previousFetch === undefined) {
    delete (globalThis as { fetch?: typeof fetch }).fetch
  } else {
    (globalThis as { fetch: typeof fetch }).fetch = previousFetch
  }
})

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => body,
  } as Response
}

function fakeDocument(view: EventTarget) {
  return {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
    defaultView: {
      location: { hash: '' },
      addEventListener: (type: string, listener: () => void) => {
        view.addEventListener(type, listener)
      },
      removeEventListener: (type: string, listener: () => void) => {
        view.removeEventListener(type, listener)
      },
    },
  }
}

describe('settings client apply', () => {
  it('declares slots and settingsScope inject', () => {
    expect(name).toBe('@wish233/dsh-friend-settings/client')
    expect(inject).toEqual(['slots', 'settingsScope'])
  })

  it('registers the settings.section card and a general-item jump button', () => {
    const registrations: Array<{ name: string; id: string; order?: number }> = []
    const surfaces: Array<string | undefined> = []
    const components: Array<{ name: string; render: (props: { close?: () => void }) => unknown }> = []
    const handle = startSettingsClient({
      slots: {
        register(options, component) {
          registrations.push({ name: options.name, id: options.id, order: options.order })
          components.push({ name: options.name, render: component })
          expect(typeof component).toBe('function')
          return () => {}
        },
      },
      settingsScope: {
        bind(spec) {
          return {
            getSnapshot: () => ({ value: spec.decode?.({}) }),
            subscribe: () => () => {},
            set: async () => {},
          }
        },
      },
    }, {
      renderSection(input) {
        surfaces.push(input.surface)
        return 'section'
      },
      renderGeneralItem: () => 'general',
    }, {
      location: { hash: '' },
    })

    expect(registrations.map((item) => ({ name: item.name, id: item.id }))).toEqual([
      { name: FRIEND_SETTINGS_SECTION_SLOT, id: FRIEND_SETTINGS_SECTION_ID },
      { name: FRIEND_SETTINGS_GENERAL_ITEM_SLOT, id: 'dsh-friend-open' },
      { name: FRIEND_SETTINGS_PLUGIN_ITEM_SLOT, id: FRIEND_SETTINGS_PLUGIN_ITEM_ID },
    ])
    const plugin = registrations.find((item) => item.name === FRIEND_SETTINGS_PLUGIN_ITEM_SLOT)
    expect(plugin?.order).toBe(FRIEND_SETTINGS_PLUGIN_ITEM_ORDER)
    expect(FRIEND_SETTINGS_PLUGIN_ITEM_ORDER).toBeGreaterThan(20)
    for (const item of components) {
      item.render({})
    }
    expect(surfaces).toEqual(['section', 'plugin'])
    handle.overlay.open('about')
    expect(handle.overlay.getState()).toEqual({ open: true, section: 'about' })
    handle.dispose()
  })

  it('mounts the config overlay on dsh-friend:open-settings', async () => {
    const mounted: string[] = []
    const view = new EventTarget()
    const handle = startSettingsClient({
      settingsScope: {
        bind(spec) {
          return {
            getSnapshot: () => ({ value: spec.decode?.({}) }),
            subscribe: () => () => {},
            set: async () => {},
          }
        },
      },
    }, {
      renderSection: () => 'section',
      renderGeneralItem: () => 'general',
      mountOverlay() {
        mounted.push('open')
        return () => {
          mounted.push('close')
        }
      },
    }, {
      location: { hash: '' },
      document: fakeDocument(view),
    })

    expect(mounted).toEqual([])
    view.dispatchEvent(new Event('dsh-friend:open-settings'))
    expect(handle.overlay.getState().open).toBe(true)
    await vi.waitFor(() => {
      expect(mounted).toEqual(['open'])
    })
    handle.dispose()
    expect(mounted).toContain('close')
  })

  it('opens the overlay from GET /friend/settings/snapshot, not settingsScope defaults', async () => {
    const live = projectDocuments({
      [FRIEND_SETTINGS_NAMESPACES.asr]: { hotkey: 'Alt+Q', mode: 'toggle', silenceMs: 800 },
    })
    ;(globalThis as { fetch: typeof fetch }).fetch = (async (url) => {
      if (String(url) === FRIEND_SETTINGS_SNAPSHOT_PATH) {
        return jsonResponse(live)
      }
      return jsonResponse({})
    }) as typeof fetch

    let snapshotHotkey: string | undefined
    const view = new EventTarget()
    const handle = startSettingsClient({
      settingsScope: {
        bind() {
          return {
            getSnapshot: () => ({ value: undefined }),
            subscribe: () => () => {},
            set: async () => {
              throw new Error('official settingsScope.set must not persist Friend namespaces')
            },
          }
        },
      },
    }, {
      renderSection: () => 'section',
      renderGeneralItem: () => 'general',
      mountOverlay(input) {
        snapshotHotkey = input.snapshot.asr.hotkey
        return () => {}
      },
    }, {
      location: { hash: '' },
      document: fakeDocument(view),
    })

    view.dispatchEvent(new Event('dsh-friend:open-settings'))
    await vi.waitFor(() => {
      expect(snapshotHotkey).toBe('Alt+Q')
    })
    handle.dispose()
  })

  it('overlay and plugin-card writers persist through POST /friend/settings/patch', async () => {
    const posts: Array<{ url: string; body: string }> = []
    const scopeSets: Array<[string, unknown]> = []
    ;(globalThis as { fetch: typeof fetch }).fetch = (async (url, init) => {
      if (String(url) === FRIEND_SETTINGS_PATCH_PATH) {
        posts.push({
          url: String(url),
          body: typeof init?.body === 'string' ? init.body : '',
        })
        return jsonResponse({ ok: true, namespace: FRIEND_SETTINGS_NAMESPACES.asr, settings: {} })
      }
      if (String(url) === FRIEND_SETTINGS_SNAPSHOT_PATH) {
        return jsonResponse(projectDocuments({}))
      }
      return jsonResponse({})
    }) as typeof fetch

    let writers: OverlayWriters | undefined
    let cardCoreSet: ((field: string, value: unknown) => Promise<void>) | undefined
    const view = new EventTarget()
    const handle = startSettingsClient({
      slots: {
        register(_options, component) {
          component({})
          return () => {}
        },
      },
      settingsScope: {
        bind() {
          return {
            getSnapshot: () => ({ value: undefined }),
            subscribe: () => () => {},
            set: async (field, value) => {
              scopeSets.push([field, value])
            },
          }
        },
      },
    }, {
      renderSection(input) {
        cardCoreSet = input.coreScope?.set.bind(input.coreScope)
        return 'section'
      },
      renderGeneralItem: () => 'general',
      mountOverlay(input) {
        writers = input.writers
        return () => {}
      },
    }, {
      location: { hash: '' },
      document: fakeDocument(view),
    })

    view.dispatchEvent(new Event('dsh-friend:open-settings'))
    await vi.waitFor(() => {
      expect(writers?.asr).toBeDefined()
    })
    await writers?.asr?.set('hotkey', 'Alt+Q')
    await cardCoreSet?.('floatEnabled', false)

    expect(scopeSets).toEqual([])
    expect(posts.some((call) => {
      const body = JSON.parse(call.body) as { namespace?: string; patch?: { hotkey?: string } }
      return call.url === FRIEND_SETTINGS_PATCH_PATH
        && body.namespace === FRIEND_SETTINGS_NAMESPACES.asr
        && body.patch?.hotkey === 'Alt+Q'
    })).toBe(true)
    expect(posts.some((call) => {
      const body = JSON.parse(call.body) as { namespace?: string; patch?: { floatEnabled?: boolean } }
      return call.url === FRIEND_SETTINGS_PATCH_PATH
        && body.namespace === FRIEND_SETTINGS_NAMESPACES.core
        && body.patch?.floatEnabled === false
    })).toBe(true)
    handle.dispose()
  })
})
