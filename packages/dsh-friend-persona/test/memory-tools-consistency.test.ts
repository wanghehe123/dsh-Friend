import { describe, expect, it } from 'vitest'

import { MEMORY_TOOL_NAMES, createMemoryTools } from '@wish233/dsh-friend-memory'

import { MEMORY_TOOLS } from '../src/presets.ts'

/**
 * Catches a drifting persona allowlist vs the tools memory actually
 * registers. Import the memory package by name (no cross-package relative
 * path), same pattern as stage's STAGE_TOOLS lock.
 */
describe('persona MEMORY_TOOLS matches memory registrations', () => {
  it('equals MEMORY_TOOL_NAMES and createMemoryTools() names', () => {
    const registered = createMemoryTools({
      store: {} as never,
      retriever: {} as never,
    }).map((tool) => tool.name)
    expect([...MEMORY_TOOLS]).toEqual([...MEMORY_TOOL_NAMES])
    expect([...MEMORY_TOOLS]).toEqual(registered)
  })
})
