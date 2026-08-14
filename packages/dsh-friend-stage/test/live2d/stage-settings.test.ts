import { describe, expect, it } from 'vitest'

import { FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared'

import { LIVE2D_TARGET_FPS } from '../../src/live2d/performance.ts'
import {
  readStageTargetFps,
  STAGE_TARGET_FPS_FIELD,
} from '../../src/live2d/stage-settings.ts'

describe('stage FPS settings', () => {
  it('reads targetFps with default 30 and uses the shared stage namespace on the host', () => {
    expect(FRIEND_SETTINGS_NAMESPACES.stage).toBe('friend-stage')
    expect(STAGE_TARGET_FPS_FIELD).toBe('targetFps')
    expect(readStageTargetFps(undefined)).toBe(LIVE2D_TARGET_FPS)
    expect(readStageTargetFps({ [STAGE_TARGET_FPS_FIELD]: 24 })).toBe(24)
    expect(readStageTargetFps({ [STAGE_TARGET_FPS_FIELD]: 0 })).toBe(1)
    expect(readStageTargetFps({ [STAGE_TARGET_FPS_FIELD]: 999 })).toBe(120)
  })
})
