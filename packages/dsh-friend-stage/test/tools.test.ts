import { describe, expect, it } from 'vitest'

import type { ToolDefinition } from '@wishp3/dsh-friend-shared'

import { apply, name } from '../src/index.ts'
import { createPerformanceTracker } from '../src/performance-state.ts'
import { createPerformanceTools, registerPerformanceTools } from '../src/tools.ts'
import { MockToolPipeline } from './helpers/tool-pipeline.ts'

function callTool(tool: ToolDefinition, args: unknown) {
  return tool.execute(args, {
    signal: new AbortController().signal,
    deferContext: () => undefined,
    concludeTurn: () => undefined,
  } as Parameters<ToolDefinition['execute']>[1])
}

function toolNamed(tools: readonly ToolDefinition[], toolName: string): ToolDefinition {
  const found = tools.find((tool) => tool.name === toolName)
  if (found === undefined) {
    throw new Error(`missing tool ${toolName}`)
  }
  return found
}

describe('performance tool parameter validation', () => {
  it('accepts the seven expression words and rejects anything else', async () => {
    const tracker = createPerformanceTracker()
    const tools = createPerformanceTools(tracker)
    const setExpression = toolNamed(tools, 'set_expression')

    await expect(callTool(setExpression, { expression: 'happy' })).resolves.toMatchObject({
      ok: true,
      expression: 'happy',
      lastAction: 'expr',
    })
    expect(tracker.snapshot().expression).toBe('happy')

    await expect(callTool(setExpression, { expression: 'excited' })).rejects.toThrow(/invalid arguments/i)
    await expect(callTool(setExpression, { expression: 'HAPPY' })).rejects.toThrow(/invalid arguments/i)
    await expect(callTool(setExpression, { expression: 'Tap' })).rejects.toThrow(/invalid arguments/i)
    await expect(callTool(setExpression, {})).rejects.toThrow(/invalid arguments/i)
    expect(tracker.snapshot().expression).toBe('happy')
  })

  it('accepts portable motion groups and rejects Hiyori-internal names', async () => {
    const tracker = createPerformanceTracker()
    const playMotion = toolNamed(createPerformanceTools(tracker), 'play_motion')

    await expect(callTool(playMotion, { group: 'Celebrate' })).resolves.toMatchObject({
      ok: true,
      motionGroup: 'Celebrate',
      lastAction: 'motion',
    })
    await expect(callTool(playMotion, { group: 'Tap' })).rejects.toThrow(/invalid arguments/i)
    await expect(callTool(playMotion, { group: 'Idle' })).resolves.toMatchObject({ motionGroup: 'Idle' })
  })

  it('accepts named cues and rejects unknown performances', async () => {
    const tracker = createPerformanceTracker()
    const playCue = toolNamed(createPerformanceTools(tracker), 'play_cue')

    await expect(callTool(playCue, { name: 'success' })).resolves.toMatchObject({
      ok: true,
      expression: 'happy',
      motionGroup: 'Celebrate',
      cue: 'success',
      lastAction: 'cue',
    })
    await expect(callTool(playCue, { name: 'dance' })).rejects.toThrow(/invalid arguments/i)
  })
})

describe('performance tools are companion-preset scoped', () => {
  it('does not register the three tools on host apply (coding sessions inherit only globals)', () => {
    const pipeline = new MockToolPipeline()
    const routes: Array<{ path: string }> = []
    apply(
      {
        webServer: {
          register(route) {
            routes.push(route)
            return () => undefined
          },
        },
        effect(execute) {
          return execute()
        },
        tools: pipeline.context().tools,
      },
      { role: 'host', performanceTracker: createPerformanceTracker() },
    )

    expect(name).toBe('@wishp3/dsh-friend-stage')
    expect(pipeline.visible()).not.toContain('set_expression')
    expect(pipeline.visible()).not.toContain('play_motion')
    expect(pipeline.visible()).not.toContain('play_cue')
    expect(routes.some((route) => route.path === '/friend/pet')).toBe(true)
  })

  it('registers the three tools only on the companion standing-mount scope', () => {
    const pipeline = new MockToolPipeline()
    const tracker = createPerformanceTracker()

    apply(
      {
        webServer: {
          register() {
            return () => undefined
          },
        },
        effect(execute) {
          return execute()
        },
        tools: pipeline.context().tools,
      },
      { role: 'host', performanceTracker: tracker },
    )

    apply(
      {
        tools: pipeline.context('friend-companion').tools,
        effect(execute) {
          return execute()
        },
      },
      { role: 'companion-preset', performanceTracker: tracker },
    )

    const coding = pipeline.visible('standard')
    expect(coding).not.toContain('set_expression')
    expect(coding).not.toContain('play_motion')
    expect(coding).not.toContain('play_cue')
    expect(pipeline.visible()).toEqual([])

    const companion = pipeline.visible('friend-companion')
    expect(companion).toEqual(['set_expression', 'play_motion', 'play_cue'])
  })

  it('unregisters the three tools when the companion disposer runs', () => {
    const pipeline = new MockToolPipeline()
    const dispose = registerPerformanceTools(
      pipeline.context('friend-companion'),
      createPerformanceTracker(),
    )
    expect(pipeline.visible('friend-companion')).toHaveLength(3)
    dispose()
    expect(pipeline.visible('friend-companion')).toEqual([])
  })

  it('fail-louds when companion-preset apply() has no tools service', () => {
    expect(() => apply({}, { role: 'companion-preset' })).toThrow(/ctx\.tools/)
  })
})
