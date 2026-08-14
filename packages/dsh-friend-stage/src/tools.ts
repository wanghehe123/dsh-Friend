import {
  defineTool,
  registerTool,
  type FriendToolContext,
  type ToolDefinition,
} from '@wish233/dsh-friend-shared'

import { HIYORI_EXPRESSIONS } from './live2d/hiyori-adapter.ts'
import type { PerformanceSnapshot, PerformanceTracker } from './performance-state.ts'
import { STAGE_CUE_NAMES, STAGE_MOTION_GROUPS } from './work-cue.ts'

export const STAGE_TOOL_NAMES = ['set_expression', 'play_motion', 'play_cue'] as const
export type StageToolName = (typeof STAGE_TOOL_NAMES)[number]

const SNAPSHOT_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    expression: { type: 'string', required: true },
    motionGroup: { type: 'string', required: true },
    cue: { type: 'string', required: true },
    lastAction: { type: 'string', required: true },
    seq: { type: 'integer', required: true },
  },
} as const

function snapshotResult(snapshot: PerformanceSnapshot) {
  return {
    ok: true as const,
    expression: snapshot.expression,
    motionGroup: snapshot.motionGroup,
    cue: snapshot.cue,
    lastAction: snapshot.lastAction,
    seq: snapshot.seq,
  }
}

function renderOk(): [] {
  return []
}

/**
 * Build the three performance tools.
 *
 * Parameter schemas are rc.6 `defineTool` {@link ParameterSchemaSpec} maps
 * (compiled to JSON Schema). They are **not** zod and **not** schemastery
 * `Schema` objects — see `docs/m0-findings.md` §5.
 */
export function createPerformanceTools(tracker: PerformanceTracker): readonly ToolDefinition[] {
  const setExpression = defineTool({
    name: 'set_expression',
    description: 'Set the companion Live2D expression from the standard 7-word vocabulary.',
    parameters: {
      expression: {
        type: 'string',
        enum: HIYORI_EXPRESSIONS,
        required: true,
        description: 'One of neutral, happy, shy, sad, surprised, sleepy, angry.',
      },
    },
    output: {
      schema: SNAPSHOT_OUTPUT,
      render: renderOk,
    },
    async execute(args) {
      return snapshotResult(tracker.setExpression(args.expression))
    },
  })

  const playMotion = defineTool({
    name: 'play_motion',
    description: 'Play a portable stage motion group (not a model-specific asset name).',
    parameters: {
      group: {
        type: 'string',
        enum: STAGE_MOTION_GROUPS,
        required: true,
        description: 'Portable motion group such as Idle, Smile, or Celebrate.',
      },
    },
    output: {
      schema: SNAPSHOT_OUTPUT,
      render: renderOk,
    },
    async execute(args) {
      return snapshotResult(tracker.setMotion(args.group))
    },
  })

  const playCue = defineTool({
    name: 'play_cue',
    description: 'Play a named performance cue (expression + motion together).',
    parameters: {
      name: {
        type: 'string',
        enum: STAGE_CUE_NAMES,
        required: true,
        description: 'Named cue such as happy, success, thinking, or error.',
      },
    },
    output: {
      schema: SNAPSHOT_OUTPUT,
      render: renderOk,
    },
    async execute(args) {
      return snapshotResult(tracker.playCue(args.name))
    },
  })

  return [setExpression, playMotion, playCue]
}

/**
 * Register the three tools on the **calling** context.
 *
 * Must run on the companion preset standing mount. A host-global
 * `register` would leak them into coding sessions.
 */
export function registerPerformanceTools(
  ctx: FriendToolContext,
  tracker: PerformanceTracker,
): () => void {
  const disposers = createPerformanceTools(tracker).map((definition) => registerTool(ctx, definition))
  return () => {
    for (const dispose of disposers.slice().reverse()) dispose()
  }
}
