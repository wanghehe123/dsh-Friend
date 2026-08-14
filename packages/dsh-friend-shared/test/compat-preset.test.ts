import { describe, expect, it, vi } from 'vitest'

import { FRIEND_PRESET_IDS, registerPreset } from '../src/dsh-compat.ts'

describe('registerPreset', () => {
  it('resolves the roster id and succeeds when the preset is not broken', async () => {
    const resolve = vi.fn(async (id?: string) => ({ id: id ?? '' }))
    const list = vi.fn(async () => [])

    await registerPreset(
      { agentPresets: { resolve, list } },
      { id: FRIEND_PRESET_IDS.companion },
    )

    expect(resolve).toHaveBeenCalledWith('friend-companion')
    expect(list).not.toHaveBeenCalled()
  })

  it('throws when the discovered preset is broken', async () => {
    const resolve = vi.fn(async () => ({
      id: 'friend-companion',
      broken: 'missing agent.cordis.yml',
    }))

    await expect(registerPreset(
      { agentPresets: { resolve, list: vi.fn(async () => []) } },
      { id: 'friend-companion' },
    )).rejects.toThrow(/broken: missing agent.cordis.yml/)
  })

  it('throws on an id that cannot be a preset directory name', async () => {
    const resolve = vi.fn()
    await expect(registerPreset(
      { agentPresets: { resolve, list: vi.fn(async () => []) } },
      { id: 'Friend.Companion' },
    )).rejects.toThrow(/invalid preset id/)
    expect(resolve).not.toHaveBeenCalled()
  })
})
