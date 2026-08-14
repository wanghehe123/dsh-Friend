/**
 * Geometry-only drawable hit testing. The pet IIFE uses this for canvas
 * clicks; the official Cubism Core mesh is reduced to triangles first.
 */

export type HitPoint = Readonly<{ x: number; y: number }>

export type HitTriangle = readonly [HitPoint, HitPoint, HitPoint]

export type HitDrawable = Readonly<{
  id: string
  opacity: number
  triangles: readonly HitTriangle[]
}>

export const HIT_OPACITY_THRESHOLD = 0.01

/** Barycentric point-in-triangle test, inclusive of edges. */
export function pointInTriangle(point: HitPoint, triangle: HitTriangle): boolean {
  const [a, b, c] = triangle
  const area = signedArea(a, b, c)
  if (Math.abs(area) < 1e-8) return false
  const a1 = signedArea(point, b, c) / area
  const a2 = signedArea(a, point, c) / area
  const a3 = signedArea(a, b, point) / area
  return a1 >= 0 && a2 >= 0 && a3 >= 0 && a1 + a2 + a3 <= 1 + 1e-6
}

/**
 * Return the first drawable whose mesh contains `point` and is visible.
 * Later drawables are assumed to be behind earlier ones.
 */
export function hitTestDrawables(
  drawables: readonly HitDrawable[],
  point: HitPoint,
  opacityThreshold = HIT_OPACITY_THRESHOLD,
): string | undefined {
  for (const drawable of drawables) {
    if (drawable.opacity < opacityThreshold) continue
    for (const triangle of drawable.triangles) {
      if (pointInTriangle(point, triangle)) return drawable.id
    }
  }
  return undefined
}

/** Map a canvas click into the model's local pixel space. */
export function canvasPointFromClient(
  client: HitPoint,
  bounds: Readonly<{ left: number; top: number; width: number; height: number }>,
): HitPoint {
  return {
    x: client.x - bounds.left,
    y: client.y - bounds.top,
  }
}

function signedArea(a: HitPoint, b: HitPoint, c: HitPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
}
