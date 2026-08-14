import { describe, expect, it } from 'vitest'

import { resolveFriendDataDir } from '@wish233/dsh-friend-shared'
import { STAGE_TOOLS, resolveFriendDataDir as resolvePersonaFriendDataDir } from '@wish233/dsh-friend-persona'

import { resolveFriendDataRoot } from '../src/live2d/asset-store.ts'
import { STAGE_TOOL_NAMES, createPerformanceTools } from '../src/tools.ts'
import { createPerformanceTracker } from '../src/performance-state.ts'

/**
 * Catches a second, drifting copy of friend-data-root resolution.
 * Same env bag + homedir must yield the same absolute directory from
 * shared, persona's public re-export, and stage's historical wrapper.
 */
const CASES: readonly {
  label: string
  env: Readonly<Record<string, string | undefined>>
  homedir: string
}[] = [
  {
    label: 'FRIEND_DATA_DIR wins over DSH_HOME',
    env: { FRIEND_DATA_DIR: '/tmp/friend-isolated', DSH_HOME: '/tmp/dsh-profile' },
    homedir: '/Users/example',
  },
  {
    label: 'relative DSH_HOME is resolved',
    env: { DSH_HOME: 'relative-dsh' },
    homedir: '/Users/example',
  },
  {
    label: 'absolute DSH_HOME',
    env: { DSH_HOME: '/tmp/dsh-profile' },
    homedir: '/Users/example',
  },
  {
    label: 'homedir fallback',
    env: {},
    homedir: '/Users/example',
  },
  {
    label: 'blank env values are missing',
    env: { FRIEND_DATA_DIR: '  ', DSH_HOME: '' },
    homedir: '/Users/example',
  },
]

describe('friend data root is one implementation', () => {
  it.each(CASES)('$label: persona, stage, and shared agree', ({ env, homedir }) => {
    const shared = resolveFriendDataDir({ env, homedir })
    const persona = resolvePersonaFriendDataDir({ env, homedir })
    const stage = resolveFriendDataRoot(env, homedir)
    expect(persona).toBe(shared)
    expect(stage).toBe(shared)
  })
})

describe('persona STAGE_TOOLS matches stage registrations', () => {
  it('equals STAGE_TOOL_NAMES and createPerformanceTools() names', () => {
    const registered = createPerformanceTools(createPerformanceTracker()).map((tool) => tool.name)
    expect([...STAGE_TOOLS]).toEqual([...STAGE_TOOL_NAMES])
    expect([...STAGE_TOOLS]).toEqual(registered)
  })
})
