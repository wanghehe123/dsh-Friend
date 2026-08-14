import { describe, expect, it } from 'vitest'

import { applyHiyoriFrame } from '../../src/live2d/hiyori-frame.ts'

describe('Hiyori expression frame', () => {
  it('applies the selected expression and keeps speech from closing an open mouth', () => {
    const values = new Map<string, number>()

    applyHiyoriFrame(
      {
        setParameterValueById(id, value) {
          values.set(id, value)
        },
      },
      'happy',
      0.72,
    )

    expect(values.get('ParamCheek')).toBe(0.8)
    expect(values.get('ParamEyeLSmile')).toBe(1)
    expect(values.get('ParamMouthOpenY')).toBe(0.72)
  })

  it('uses the expression mouth value when lip sync is quieter', () => {
    const values = new Map<string, number>()

    applyHiyoriFrame(
      {
        setParameterValueById(id, value) {
          values.set(id, value)
        },
      },
      'surprised',
      0.1,
    )

    expect(values.get('ParamMouthOpenY')).toBe(0.85)
  })
})
