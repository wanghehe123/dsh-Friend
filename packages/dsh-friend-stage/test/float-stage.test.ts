import { describe, expect, it, vi } from 'vitest'

import {
  applyCornerResize,
  applyPointerDrag,
  chooseAvoidingCorner,
  detectDshPet,
  persistFloatMuted,
  persistFloatRect,
  rectFromSettings,
} from '../src/float-stage.ts'
import { readStageUiSettings } from '../src/live2d/stage-settings.ts'

describe('float stage geometry and avoidance', () => {
  const viewport = { width: 1280, height: 800 }

  it('drags by the pointer delta and persists the new rect', async () => {
    const start = { left: 900, top: 400, width: 280, height: 360 }
    const moved = applyPointerDrag(start, { x: 100, y: 100 }, { x: 40, y: 20 }, viewport)
    expect(moved.left).toBe(840)
    expect(moved.top).toBe(320)

    const writes: Record<string, unknown> = {}
    await persistFloatRect({
      get: () => readStageUiSettings(writes),
      set: async (field, value) => {
        writes[field] = value
      },
    }, moved)
    expect(writes).toMatchObject({
      floatLeft: 840,
      floatTop: 320,
      floatWidth: 280,
      floatHeight: 360,
    })
  })

  it('resizes from all four corners without shrinking below the minimum', () => {
    const start = { left: 200, top: 200, width: 280, height: 360 }
    const br = applyCornerResize(start, 'bottom-right', { x: 480, y: 560 }, { x: 500, y: 600 }, viewport)
    expect(br.width).toBe(300)
    expect(br.height).toBe(400)

    const tl = applyCornerResize(start, 'top-left', { x: 200, y: 200 }, { x: 400, y: 500 }, viewport)
    expect(tl.width).toBeGreaterThanOrEqual(160)
    expect(tl.height).toBeGreaterThanOrEqual(200)
  })

  it('avoids the official dsh-pet corner when its container is present', () => {
    expect(chooseAvoidingCorner(false)).toBe('bottom-right')
    expect(chooseAvoidingCorner(true)).toBe('bottom-left')
    expect(detectDshPet({ querySelector: (selector) => selector === '#dsh-pet' ? {} : null })).toBe(true)
    expect(detectDshPet({ querySelector: () => null })).toBe(false)
  })

  it('restores a persisted top-left position after reload', () => {
    const settings = readStageUiSettings({
      floatLeft: 12,
      floatTop: 16,
      floatWidth: 280,
      floatHeight: 360,
    })
    expect(rectFromSettings(settings, viewport, 'bottom-right')).toEqual({
      left: 12,
      top: 16,
      width: 280,
      height: 360,
    })
  })
})

describe('float persist writes are sequenced', () => {
  it('records pointer-down / move / up as one persisted rect', async () => {
    const set = vi.fn(async () => undefined)
    let rect = { left: 100, top: 100, width: 280, height: 360 }
    rect = applyPointerDrag(rect, { x: 10, y: 10 }, { x: 30, y: 40 }, { width: 1000, height: 800 })
    await persistFloatRect({ get: () => readStageUiSettings({}), set }, rect)
    expect(set).toHaveBeenCalledTimes(4)
    expect(set.mock.calls[0]?.[1]).toBe(120)
    expect(set.mock.calls[1]?.[1]).toBe(130)
  })

  it('mirrors floatMuted onto the TTS playback store when one is provided', async () => {
    const stage: Record<string, unknown> = {}
    const playback: Record<string, unknown> = {}
    await persistFloatMuted({
      get: () => readStageUiSettings(stage),
      set: async (field, value) => {
        stage[field] = value
      },
    }, true, {
      set: async (field, value) => {
        playback[field] = value
      },
    })
    expect(stage.floatMuted).toBe(true)
    expect(playback.muted).toBe(true)
  })
})
