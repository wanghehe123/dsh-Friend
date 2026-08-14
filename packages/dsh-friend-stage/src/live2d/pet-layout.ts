export type PetSize = Readonly<{ width: number; height: number }>

export type PetLayout = Readonly<{
  scale: number
  x: number
  y: number
}>

/**
 * Fit a loaded Cubism model into the pet canvas.
 *
 * `Live2DModel.getLocalBounds()` is often 0×0 until the first
 * `model.update()`. Treating that as 1×1 (the old fallback) scales the
 * model by hundreds and crops to a transparent texel or a face close-up.
 */
export function computePetLayout(localBounds: PetSize, view: PetSize): PetLayout | undefined {
  if (
    !Number.isFinite(localBounds.width)
    || !Number.isFinite(localBounds.height)
    || localBounds.width < 8
    || localBounds.height < 8
  ) {
    return undefined
  }
  const width = Math.max(1, view.width)
  const height = Math.max(1, view.height)
  return {
    scale: Math.min((width * 0.88) / localBounds.width, (height * 0.95) / localBounds.height),
    x: width / 2,
    y: height * 0.985,
  }
}
