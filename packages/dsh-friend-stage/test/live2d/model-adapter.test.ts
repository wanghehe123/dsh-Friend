import { describe, expect, it } from 'vitest'

import { generateDefaultFriendMap } from '../../src/model-map.ts'
import {
  expressionNameFromMapFile,
  resolveMappedMotion,
  shouldApplyHiyoriPresets,
} from '../../src/live2d/model-adapter.ts'

const naiwaMap = generateDefaultFriendMap({
  FileReferences: {
    Expressions: [
      { Name: 'calm', File: 'expressions/calm.exp3.json' },
      { Name: 'smile', File: 'expressions/smile.exp3.json' },
      { Name: 'surprise', File: 'expressions/surprise.exp3.json' },
    ],
    Motions: {
      Idle: [{ File: 'motions/idle.motion3.json' }],
    },
  },
})

describe('friend.map.json motion adapter', () => {
  it('uses the model motion group when it exists and otherwise falls back', () => {
    expect(naiwaMap.expressions.neutral).toBe('expressions/calm.exp3.json')
    expect(naiwaMap.expressions.happy).toBe('expressions/smile.exp3.json')
    expect(shouldApplyHiyoriPresets(naiwaMap)).toBe(false)
    expect(resolveMappedMotion(naiwaMap, 'Idle')).toEqual({ group: 'Idle', index: 0 })
    expect(resolveMappedMotion(naiwaMap, 'Celebrate')).toEqual({ group: 'Idle', index: 0 })
    expect(expressionNameFromMapFile('expressions/smile.exp3.json')).toBe('smile')
  })

  it('keeps the Hiyori parameter path when the map has no expression files', () => {
    const hiyori = generateDefaultFriendMap({
      FileReferences: {
        Motions: {
          Idle: [{ File: 'motion/a.motion3.json' }, { File: 'motion/b.motion3.json' }],
          Tap: [{ File: 'motion/tap.motion3.json' }],
        },
      },
    })
    expect(shouldApplyHiyoriPresets(hiyori)).toBe(true)
    expect(resolveMappedMotion(hiyori, 'Thinking')).toEqual({ group: 'Idle', index: 1 })
    expect(resolveMappedMotion(hiyori, 'Celebrate')).toEqual({ group: 'Tap', index: 0 })
  })
})
