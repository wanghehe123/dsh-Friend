/** Default cap; override via the friend-stage settings field `targetFps`. */
export const LIVE2D_TARGET_FPS = 30

/** Hot-update a running ticker without remounting the Live2D model. */
export function applyTickerMaxFps(clock: { maxFPS: number }, fps: number): void {
  if (typeof fps !== 'number' || !Number.isFinite(fps)) return
  clock.maxFPS = Math.min(120, Math.max(1, Math.round(fps)))
}

export type AnimationClock = {
  maxFPS: number
  start(): void
  stop(): void
}

export type VisibilityDocument = {
  visibilityState: 'visible' | 'hidden' | 'prerender' | 'unloaded'
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

export type VisibilityPauseOptions = Readonly<{
  maxFPS?: number
}>

/** Cap rendering and suspend the ticker whenever the page is not visible. */
export function bindVisibilityPause(
  clock: AnimationClock,
  documentLike: VisibilityDocument,
  options: VisibilityPauseOptions = {},
): () => void {
  clock.maxFPS = options.maxFPS ?? LIVE2D_TARGET_FPS

  const sync = (): void => {
    if (documentLike.visibilityState === 'visible') {
      clock.start()
    } else {
      clock.stop()
    }
  }

  documentLike.addEventListener('visibilitychange', sync)
  sync()

  return (): void => {
    documentLike.removeEventListener('visibilitychange', sync)
  }
}
