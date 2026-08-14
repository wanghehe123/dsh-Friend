export type CubismCoreGlobal = {
  Live2DCubismCore?: unknown
}

export class CubismCoreMissingError extends Error {
  constructor() {
    super('Live2D Cubism Core is not loaded. The pet page must include the official Core script before the stage IIFE.')
    this.name = 'CubismCoreMissingError'
  }
}

/** Fail loudly when the official Core global is missing (W-M4-1 loader path). */
export function requireCubismCore(globalLike: object): unknown {
  const core = (globalLike as CubismCoreGlobal).Live2DCubismCore
  if (core === undefined || core === null) {
    throw new CubismCoreMissingError()
  }
  return core
}
