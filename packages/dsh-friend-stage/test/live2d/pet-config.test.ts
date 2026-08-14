import { describe, expect, it } from 'vitest'

import { cueForExpression, readPetPageConfig } from '../../src/live2d/pet-config.ts'

describe('standalone pet page configuration', () => {
  it('accepts only a local Hiyori asset URL and a supported initial expression', () => {
    expect(readPetPageConfig({
      modelUrl: '/friend/assets/vendor/hiyori/hiyori_free/runtime/hiyori_free_t08.model3.json',
      canvasId: 'friend-live2d',
      statusId: 'friend-live2d-status',
      initialExpression: 'neutral',
    })).toEqual({
      modelUrl: '/friend/assets/vendor/hiyori/hiyori_free/runtime/hiyori_free_t08.model3.json',
      canvasId: 'friend-live2d',
      statusId: 'friend-live2d-status',
      initialExpression: 'neutral',
      targetFps: 30,
    })

    expect(readPetPageConfig({
      modelUrl: 'https://example.invalid/model3.json',
      canvasId: 'friend-live2d',
      statusId: 'friend-live2d-status',
      initialExpression: 'neutral',
    })).toBeUndefined()

    expect(readPetPageConfig({
      modelUrl: '/friend/assets/models/neko/runtime/neko.model3.json',
      canvasId: 'friend-live2d',
      statusId: 'friend-live2d-status',
      initialExpression: 'happy',
    })?.modelUrl).toBe('/friend/assets/models/neko/runtime/neko.model3.json')

    expect(readPetPageConfig({
      modelUrl: '/friend/assets/models/../vendor/secret.model3.json',
      canvasId: 'friend-live2d',
      statusId: 'friend-live2d-status',
      initialExpression: 'neutral',
    })).toBeUndefined()
  })

  it('turns every UI expression into a real stage cue', () => {
    expect(cueForExpression('neutral')).toEqual({
      expression: 'neutral', motionGroup: 'Idle', loop: true,
    })
    expect(cueForExpression('happy')).toEqual({
      expression: 'happy', motionGroup: 'Smile', loop: false,
    })
    expect(cueForExpression('sleepy')).toEqual({
      expression: 'sleepy', motionGroup: 'Sleepy', loop: true,
    })
    expect(cueForExpression('angry')).toEqual({
      expression: 'angry', motionGroup: 'Angry', loop: false,
    })
  })
})
