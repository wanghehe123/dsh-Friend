import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { FRIEND_PRESET_IDS } from '@wishp3/dsh-friend-shared'

import {
  COMPANION_TOOL_ALLOWLIST,
  PLUS_TOOL_ALLOWLIST,
  allowlistFor,
  assertFriendPresets,
  formatPresetReadyLog,
  publishShippedPresets,
  resolveShippedPresetsRoot,
  restrictCompanionTools,
} from '../src/presets.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('tool allowlists', () => {
  it('lists the companion whitelist as a constant array', () => {
    expect([...COMPANION_TOOL_ALLOWLIST]).toEqual([
      'notify',
      'get_current_time',
    ])
  })

  it('makes plus a super-set of companion', () => {
    expect(COMPANION_TOOL_ALLOWLIST.every((tool) => (PLUS_TOOL_ALLOWLIST as readonly string[]).includes(tool))).toBe(true)
    expect([...PLUS_TOOL_ALLOWLIST]).toEqual([
      ...COMPANION_TOOL_ALLOWLIST,
      'web_search',
      'read',
    ])
    expect(PLUS_TOOL_ALLOWLIST).not.toContain('bash')
    expect(PLUS_TOOL_ALLOWLIST).not.toContain('write')
    expect(PLUS_TOOL_ALLOWLIST).not.toContain('edit')
    expect(allowlistFor('companion')).toBe(COMPANION_TOOL_ALLOWLIST)
    expect(allowlistFor('plus')).toBe(PLUS_TOOL_ALLOWLIST)
  })
})

describe('assertFriendPresets', () => {
  it('fail-louds when resolve marks a preset broken', async () => {
    const resolve = vi.fn(async (id?: string) => ({
      id: id ?? '',
      broken: 'missing agent.cordis.yml',
    }))

    await expect(assertFriendPresets(
      { agentPresets: { resolve, list: vi.fn(async () => []) } },
      '/tmp/fake-agent-presets',
    )).rejects.toThrow(/friend-companion[\s\S]*broken/)
  })

  it('resolves both shipped ids when they are healthy', async () => {
    const resolve = vi.fn(async (id?: string) => ({ id: id ?? '' }))
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      await assertFriendPresets(
        { agentPresets: { resolve, list: vi.fn(async () => []) } },
        '/tmp/fake-agent-presets',
      )
      expect(resolve).toHaveBeenCalledWith(FRIEND_PRESET_IDS.companion)
      expect(resolve).toHaveBeenCalledWith(FRIEND_PRESET_IDS.companionPlus)
      expect(info).toHaveBeenCalledWith(formatPresetReadyLog(FRIEND_PRESET_IDS.companion))
      expect(info).toHaveBeenCalledWith(formatPresetReadyLog(FRIEND_PRESET_IDS.companionPlus))
    } finally {
      info.mockRestore()
    }
  })
})

describe('publishShippedPresets (Plan B)', () => {
  it('copies both preset directories into an isolated dshHome/.agent-presets', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-friend-persona-presets-'))
    temporaryRoots.push(dshHome)

    const published = await publishShippedPresets({ dshHome })
    expect(published.destRoot).toBe(join(dshHome, '.agent-presets'))
    expect(published.ids).toEqual([
      FRIEND_PRESET_IDS.companion,
      FRIEND_PRESET_IDS.companionPlus,
    ])

    const companionYml = await readFile(
      join(published.destRoot, 'friend-companion', 'agent.cordis.yml'),
      'utf8',
    )
    const plusYml = await readFile(
      join(published.destRoot, 'friend-companion-plus', 'agent.cordis.yml'),
      'utf8',
    )
    const companionMeta = await readFile(
      join(published.destRoot, 'friend-companion', 'preset.yml'),
      'utf8',
    )

    expect(companionYml).toContain('name: \'@wishp3/dsh-friend-persona\'')
    expect(companionYml).toContain('role: companion-preset')
    expect(companionYml).toContain('allowlist: companion')
    expect(companionYml).toContain('name: \'@wishp3/dsh-friend-stage\'')
    expect(companionYml).toContain('name: \'@wishp3/dsh-friend-memory\'')
    expect(companionYml).toMatch(/id: dsh-friend-memory\n  name: '@wishp3\/dsh-friend-memory'\n  config:\n    role: companion-preset/)
    expect(companionYml).not.toContain('dsh-tool-web')
    expect(plusYml).toContain('allowlist: plus')
    expect(plusYml).toContain('name: \'@deepseek-ai/dsh-tool-web\'')
    expect(plusYml).toContain('name: \'@wishp3/dsh-friend-stage\'')
    expect(plusYml).toContain('name: \'@wishp3/dsh-friend-memory\'')
    expect(plusYml).toMatch(/id: dsh-friend-memory\n  name: '@wishp3\/dsh-friend-memory'\n  config:\n    role: companion-preset/)
    expect(plusYml).toContain('fetch: false')
    expect(companionMeta).toContain('name: 伴侣')
    expect(companionYml).toContain('role-split')
    expect(companionYml).not.toContain('would collide if listed')
  })

  it('resolves the shipped presets root next to this package', async () => {
    const root = resolveShippedPresetsRoot()
    const composition = await readFile(join(root, 'friend-companion', 'agent.cordis.yml'), 'utf8')
    expect(composition.startsWith('# friend-companion')).toBe(true)
  })
})

describe('restrictCompanionTools', () => {
  it('forwards the companion allowlist through compat restrictTools', () => {
    const disposeRestrict = vi.fn()
    const restrict = vi.fn(() => disposeRestrict)
    const dispose = restrictCompanionTools(
      { tools: { register: vi.fn(), restrict } },
      'companion',
    )
    expect(restrict).toHaveBeenCalledWith({ allow: [...COMPANION_TOOL_ALLOWLIST] })
    dispose()
    expect(disposeRestrict).toHaveBeenCalledOnce()
  })

  it('drops inherited names that are not global so official restrict can mount', () => {
    const restrict = vi.fn(() => () => undefined)
    restrictCompanionTools(
      {
        tools: {
          register: vi.fn(),
          restrict,
          get(name: string) {
            return name === 'notify' ? { name } : undefined
          },
        },
      },
      'plus',
    )
    expect(restrict).toHaveBeenCalledWith({ allow: ['notify'] })
  })

  it('allows an empty inherited catalog', () => {
    const restrict = vi.fn(() => () => undefined)
    restrictCompanionTools(
      {
        tools: {
          register: vi.fn(),
          restrict,
          get() {
            return undefined
          },
        },
      },
      'companion',
    )
    expect(restrict).toHaveBeenCalledWith({ allow: [] })
  })
})

describe('package contract', () => {
  it('ships the presets directory in package.json files', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { files: string[] }
    expect(manifest.files).toContain('presets')
  })
})
