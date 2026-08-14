import { describe, expect, it } from 'vitest'

import { startSettingsClient } from '../src/client-register.ts'
import { inject, name } from '../src/client-meta.ts'
import {
  FRIEND_SETTINGS_GENERAL_ITEM_SLOT,
  FRIEND_SETTINGS_SECTION_ID,
  FRIEND_SETTINGS_SECTION_SLOT,
} from '../src/paths.ts'

describe('settings client apply', () => {
  it('declares slots and settingsScope inject', () => {
    expect(name).toBe('@wish233/dsh-friend-settings/client')
    expect(inject).toEqual(['slots', 'settingsScope'])
  })

  it('registers the settings.section card and a general-item jump button', () => {
    const registrations: Array<{ name: string; id: string }> = []
    const handle = startSettingsClient({
      slots: {
        register(options, component) {
          registrations.push({ name: options.name, id: options.id })
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
      renderSection: () => 'section',
      renderGeneralItem: () => 'general',
    }, {
      location: { hash: '' },
    })

    expect(registrations).toEqual([
      { name: FRIEND_SETTINGS_SECTION_SLOT, id: FRIEND_SETTINGS_SECTION_ID },
      { name: FRIEND_SETTINGS_GENERAL_ITEM_SLOT, id: 'dsh-friend-open' },
    ])
    handle.overlay.open('about')
    expect(handle.overlay.getState()).toEqual({ open: true, section: 'about' })
    handle.dispose()
  })

  it('mounts the config overlay on dsh-friend:open-settings', () => {
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
      document: {
        getElementById: () => null,
        createElement: () => ({ id: '', textContent: '' }),
        head: { appendChild: () => {} },
        defaultView: {
          location: { hash: '' },
          addEventListener: (type, listener) => {
            view.addEventListener(type, listener)
          },
          removeEventListener: (type, listener) => {
            view.removeEventListener(type, listener)
          },
        },
      },
    })

    expect(mounted).toEqual([])
    view.dispatchEvent(new Event('dsh-friend:open-settings'))
    expect(handle.overlay.getState().open).toBe(true)
    expect(mounted).toEqual(['open'])
    handle.dispose()
    expect(mounted).toContain('close')
  })
})
