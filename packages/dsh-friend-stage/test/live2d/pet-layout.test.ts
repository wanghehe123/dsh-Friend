import { describe, expect, it } from 'vitest'

import { computePetLayout } from '../../src/live2d/pet-layout.ts'

describe('pet model layout', () => {
  it('refuses to scale from an empty pre-update bounding box', () => {
    expect(computePetLayout({ width: 0, height: 0 }, { width: 800, height: 736 })).toBeUndefined()
    expect(computePetLayout({ width: 1, height: 1 }, { width: 800, height: 736 })).toBeUndefined()
  })

  it('fits a ready model into the view without blowing up to a face crop', () => {
    const layout = computePetLayout({ width: 2400, height: 4800 }, { width: 800, height: 736 })
    expect(layout).toEqual({
      scale: Math.min((800 * 0.88) / 2400, (736 * 0.95) / 4800),
      x: 400,
      y: 736 * 0.985,
    })
    expect(layout?.scale).toBeLessThan(0.5)
  })
})
