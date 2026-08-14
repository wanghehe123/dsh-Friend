import { describe, expect, it } from 'vitest'

import { LIVE2D_TARGET_FPS, applyTickerMaxFps, bindVisibilityPause } from '../../src/live2d/performance.ts'

describe('Live2D animation performance policy', () => {
  it('caps animation at the documented 30 FPS target', () => {
    expect(LIVE2D_TARGET_FPS).toBe(30)
  })

  it('stops rendering while the document is hidden and resumes when visible', () => {
    let listener: (() => void) | undefined
    const clock = {
      maxFPS: 0,
      starts: 0,
      stops: 0,
      start() {
        this.starts += 1
      },
      stop() {
        this.stops += 1
      },
    }
    const documentLike = {
      visibilityState: 'visible' as 'visible' | 'hidden',
      addEventListener(_name: 'visibilitychange', callback: () => void) {
        listener = callback
      },
      removeEventListener(_name: 'visibilitychange', callback: () => void) {
        if (listener === callback) listener = undefined
      },
    }

    const dispose = bindVisibilityPause(clock, documentLike)
    expect(clock.maxFPS).toBe(30)
    expect(clock.starts).toBe(1)

    documentLike.visibilityState = 'hidden'
    listener?.()
    expect(clock.stops).toBe(1)

    documentLike.visibilityState = 'visible'
    listener?.()
    expect(clock.starts).toBe(2)

    dispose()
    listener?.()
    expect(clock.starts).toBe(2)
  })

  it('applies a configured FPS cap instead of the default 30', () => {
    const clock = {
      maxFPS: 0,
      start() {},
      stop() {},
    }
    const documentLike = {
      visibilityState: 'visible' as const,
      addEventListener() {},
      removeEventListener() {},
    }
    bindVisibilityPause(clock, documentLike, { maxFPS: 24 })
    expect(clock.maxFPS).toBe(24)
  })

  it('hot-updates maxFPS on a running ticker and clamps the same way as settings', () => {
    const clock = { maxFPS: 30 }
    applyTickerMaxFps(clock, 24)
    expect(clock.maxFPS).toBe(24)
    applyTickerMaxFps(clock, 999)
    expect(clock.maxFPS).toBe(120)
    applyTickerMaxFps(clock, 0)
    expect(clock.maxFPS).toBe(1)
  })
})
