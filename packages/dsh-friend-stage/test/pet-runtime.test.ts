import { describe, expect, it } from 'vitest'

import {
  applyPetPageEnabled,
  coreVisibleFromSettingsSnapshot,
  fetchRuntimeEnabled,
  fetchStageVisible,
  runtimeEnabledFromUnknown,
} from '../src/pet-runtime.ts'

describe('pet page follows /friend/stage/runtime.enabled', () => {
  it('reads an explicit enabled boolean and ignores missing fields', () => {
    expect(runtimeEnabledFromUnknown({ enabled: false })).toBe(false)
    expect(runtimeEnabledFromUnknown({ enabled: true })).toBe(true)
    expect(runtimeEnabledFromUnknown({})).toBeUndefined()
    expect(runtimeEnabledFromUnknown(undefined)).toBeUndefined()
  })

  it('hides the canvas and root document when the host switch is off', () => {
    const canvas = { hidden: false }
    const doc = {
      documentElement: { hidden: false, style: { visibility: 'visible' } },
      getElementById(id: string) {
        return id === 'friend-live2d' ? canvas : null
      },
    }
    applyPetPageEnabled(doc, false)
    expect(canvas.hidden).toBe(true)
    expect(doc.documentElement.hidden).toBe(false)
    expect(doc.documentElement.style.visibility).toBe('visible')
    applyPetPageEnabled(doc, true)
    expect(canvas.hidden).toBe(false)
    expect(doc.documentElement.hidden).toBe(false)
  })

  it('reads enabled from the runtime snapshot', async () => {
    const enabled = await fetchRuntimeEnabled(async () => ({
      ok: true,
      json: async () => ({ enabled: false, targetFps: 24 }),
    }))
    expect(enabled).toBe(false)
  })

  it('prefers the settings snapshot over a fail-open runtime', async () => {
    expect(coreVisibleFromSettingsSnapshot({
      core: { enabled: false, floatEnabled: true },
    })).toBe(false)

    const visible = await fetchStageVisible(async (input) => {
      if (input === '/friend/settings/snapshot') {
        return {
          ok: true,
          json: async () => ({ core: { enabled: false, floatEnabled: true } }),
        }
      }
      return {
        ok: true,
        json: async () => ({ enabled: true }),
      }
    })
    expect(visible).toBe(false)
  })
})
