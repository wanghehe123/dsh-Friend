import { describe, expect, it } from 'vitest'

import {
  HIYORI_EXPRESSIONS,
  getHiyoriExpressionPreset,
  resolveHiyoriMotion,
} from '../../src/live2d/hiyori-adapter.ts'

describe('official Hiyori adapter', () => {
  it('provides the seven public expression names promised by the stage contract', () => {
    expect(HIYORI_EXPRESSIONS).toEqual([
      'neutral',
      'happy',
      'shy',
      'sad',
      'surprised',
      'sleepy',
      'angry',
    ])
  })

  it('turns an expression into safe Hiyori Cubism parameter overrides', () => {
    expect(getHiyoriExpressionPreset('happy')).toMatchObject({
      ParamCheek: 0.8,
      ParamEyeLSmile: 1,
      ParamEyeRSmile: 1,
      ParamMouthForm: 1,
    })
    expect(getHiyoriExpressionPreset('surprised')).toMatchObject({
      ParamEyeLOpen: 1,
      ParamEyeROpen: 1,
      ParamMouthOpenY: 0.85,
    })
    expect(getHiyoriExpressionPreset('sleepy')).toMatchObject({
      ParamEyeLOpen: 0.25,
      ParamEyeROpen: 0.25,
    })
  })

  it('maps abstract work motions to real groups contained in Hiyori FREE model3.json', () => {
    expect(resolveHiyoriMotion('Idle')).toEqual({ group: 'Idle', index: 0 })
    expect(resolveHiyoriMotion('Thinking')).toEqual({ group: 'Idle', index: 1 })
    expect(resolveHiyoriMotion('Celebrate')).toEqual({ group: 'Tap', index: 0 })
    expect(resolveHiyoriMotion('Embarrassed')).toEqual({ group: 'FlickDown', index: 0 })
    expect(resolveHiyoriMotion('Sleepy')).toEqual({ group: 'Idle', index: 2 })
  })
})
