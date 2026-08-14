import { describe, expect, it, vi } from 'vitest'

import { defineTool as officialDefineTool } from '@deepseek-ai/dsh-tools'

import {
  defineTool,
  registerTool,
  restrictTools,
} from '../src/dsh-compat.ts'

function sampleTool() {
  return defineTool({
    name: 'friend_compat_ping',
    description: 'compat ping',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } },
      render() {
        return []
      },
    },
    async execute() {
      return { ok: true }
    },
  })
}

describe('registerTool', () => {
  it('re-exports the official defineTool helper', () => {
    expect(defineTool).toBe(officialDefineTool)
    expect(sampleTool().name).toBe('friend_compat_ping')
  })

  it('forwards the definition to tools.register and returns that disposer unchanged', () => {
    const disposeTool = vi.fn()
    const register = vi.fn(() => disposeTool)
    const restrict = vi.fn()
    const effect = vi.fn()
    const definition = sampleTool()

    const dispose = registerTool(
      { tools: { register, restrict }, effect },
      definition,
    )

    expect(register).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledWith(definition)
    expect(dispose).toBe(disposeTool)
    expect(effect).not.toHaveBeenCalled()
    dispose()
    expect(disposeTool).toHaveBeenCalledOnce()
  })
})

describe('restrictTools', () => {
  it('forwards the filter to tools.restrict and returns that disposer unchanged', () => {
    const disposeRestrict = vi.fn()
    const restrict = vi.fn(() => disposeRestrict)
    const register = vi.fn()
    const effect = vi.fn()
    const filter = { allow: ['memory_search', 'memory_write'] }

    const dispose = restrictTools(
      { tools: { register, restrict }, effect },
      filter,
    )

    expect(restrict).toHaveBeenCalledWith(filter)
    expect(dispose).toBe(disposeRestrict)
    expect(effect).not.toHaveBeenCalled()
    dispose()
    expect(disposeRestrict).toHaveBeenCalledOnce()
  })
})
