import { describe, expect, it } from 'vitest'

import { createLive2DController } from '../../src/live2d/controller.ts'

describe('Live2D controller parameter writes', () => {
  it('writes the happy preset then overlays lip-sync on the mouth', () => {
    const writes: Array<[string, number]> = []
    const controller = createLive2DController({
      setParameterValueById(id, value) {
        writes.push([id, value])
      },
    })

    controller.setExpression('happy')
    controller.setLipSync(0.6)
    controller.applyFrame()

    expect(controller.snapshot()).toEqual({ expression: 'happy', lipSync: 0.6 })
    expect(writes.some(([id, value]) => id === 'ParamCheek' && value === 0.8)).toBe(true)
    expect(writes.some(([id, value]) => id === 'ParamMouthOpenY' && value === 0.6)).toBe(true)
  })
})
