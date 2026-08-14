import { describe, expect, it } from 'vitest'

import { CubismCoreMissingError, requireCubismCore } from '../../src/live2d/cubism-core-loader.ts'

describe('Cubism Core loader', () => {
  it('returns the global when the official Core script has run', () => {
    const core = { version: '4' }
    expect(requireCubismCore({ Live2DCubismCore: core })).toBe(core)
  })

  it('throws a dedicated error when the Core global is missing', () => {
    expect(() => requireCubismCore({})).toThrow(CubismCoreMissingError)
    expect(() => requireCubismCore({ Live2DCubismCore: null })).toThrow(/Core is not loaded/)
  })
})
