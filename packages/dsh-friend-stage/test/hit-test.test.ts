import { describe, expect, it } from 'vitest'

import { canvasPointFromClient, hitTestDrawables, pointInTriangle } from '../src/hit-test.ts'

describe('drawable hit-test geometry', () => {
  const square: readonly [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }][] = [
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  ]

  it('accepts points inside a triangle and rejects points outside', () => {
    expect(pointInTriangle({ x: 2, y: 2 }, square[0]!)).toBe(true)
    expect(pointInTriangle({ x: 20, y: 20 }, square[0]!)).toBe(false)
  })

  it('returns the first visible drawable that contains the point', () => {
    const hits = hitTestDrawables([
      { id: 'hair', opacity: 0, triangles: square },
      { id: 'body', opacity: 1, triangles: square },
      { id: 'face', opacity: 1, triangles: square },
    ], { x: 3, y: 3 })
    expect(hits).toBe('body')
  })

  it('skips transparent drawables and misses empty space', () => {
    expect(hitTestDrawables([
      { id: 'ghost', opacity: 0.005, triangles: square },
    ], { x: 3, y: 3 })).toBeUndefined()
    expect(hitTestDrawables([
      { id: 'body', opacity: 1, triangles: square },
    ], { x: 40, y: 40 })).toBeUndefined()
  })

  it('maps a client click into canvas space', () => {
    expect(canvasPointFromClient({ x: 120, y: 80 }, { left: 100, top: 50, width: 200, height: 200 }))
      .toEqual({ x: 20, y: 30 })
  })
})
