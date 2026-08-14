/**
 * Host-only schemastery schema for `friend-stage`.
 * Imported from `index.ts` only — never from the client half.
 */
import { Schema, type FriendSchema } from '@wishp3/dsh-friend-shared'

import { LIVE2D_TARGET_FPS } from './live2d/performance.ts'
import {
  DEFAULT_BUBBLE_TIMEOUT_MS,
  DEFAULT_FLOAT_HEIGHT,
  DEFAULT_FLOAT_WIDTH,
} from './live2d/stage-settings.ts'

export const DEFAULT_STAGE_SETTINGS_ENTRY = {
  targetFps: LIVE2D_TARGET_FPS,
  floatWidth: DEFAULT_FLOAT_WIDTH,
  floatHeight: DEFAULT_FLOAT_HEIGHT,
  floatHidden: false,
  floatMuted: false,
  bubbleTimeoutMs: DEFAULT_BUBBLE_TIMEOUT_MS,
}

export function createFriendStageSettingsSchema(): FriendSchema {
  return Schema.object({
    targetFps: Schema.number().default(LIVE2D_TARGET_FPS),
    floatLeft: Schema.number(),
    floatTop: Schema.number(),
    floatWidth: Schema.number().default(DEFAULT_FLOAT_WIDTH),
    floatHeight: Schema.number().default(DEFAULT_FLOAT_HEIGHT),
    floatHidden: Schema.boolean().default(false),
    floatMuted: Schema.boolean().default(false),
    bubbleTimeoutMs: Schema.number().default(DEFAULT_BUBBLE_TIMEOUT_MS),
  })
}
