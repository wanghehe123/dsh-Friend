import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFriendSettingsInstallProbe, FRIEND_PRESET_IDS, FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared'

import {
  apply,
  applyPersona,
  inject,
  resetSharedCompanionReplyHub,
  type FriendPersonaContext,
} from '../src/index.ts'
import { DEFAULT_PERSONA, DEFAULT_PERSONA_SLUG } from '../src/default-persona.ts'
import { COMPANION_TOOL_ALLOWLIST, PLUS_TOOL_ALLOWLIST } from '../src/presets.ts'
import { CONDUCT_SECTION_NAME, PERSONA_SECTION_NAME } from '../src/sections.ts'
import { personaFilePath } from '../src/paths.ts'
import { FRIEND_SECTION_MARKERS, MockPromptPipeline } from './helpers/prompt-pipeline.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  resetSharedCompanionReplyHub()
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function isolatedHomes(): Promise<{ dataDir: string; dshHome: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-friend-persona-apply-'))
  temporaryRoots.push(root)
  return {
    dataDir: join(root, 'friend'),
    dshHome: join(root, 'dsh-home'),
  }
}

function hostCtx(overrides: {
  resolve?: (id?: string) => Promise<{ id: string; broken?: string }>
  agents?: FriendPersonaContext['agents']
  settings?: FriendPersonaContext['settings']
} = {}): FriendPersonaContext & {
  resolve: ReturnType<typeof vi.fn>
  section: ReturnType<typeof vi.fn>
  restrict: ReturnType<typeof vi.fn>
} {
  const resolve = overrides.resolve
    ?? vi.fn(async (id?: string) => ({ id: id ?? '' }))
  const section = vi.fn(() => vi.fn())
  const restrict = vi.fn(() => vi.fn())
  return {
    resolve,
    section,
    restrict,
    agentPresets: {
      resolve,
      list: vi.fn(async () => []),
    },
    systemPrompt: { section },
    tools: { register: vi.fn(), restrict },
    agents: overrides.agents,
    settings: overrides.settings,
  }
}

describe('cordis inject', () => {
  it('declares the services apply() reads so the host proxy does not throw', () => {
    expect(inject).toEqual(['agentPresets', 'systemPrompt', 'tools', 'agents', 'settings'])
  })
})

describe('apply() host wiring', () => {
  it('registers friend-persona on the production host path', async () => {
    const { dataDir, dshHome } = await isolatedHomes()
    const probe = createFriendSettingsInstallProbe()
    const ctx = { ...hostCtx(), ...probe }
    const dispose = await apply(ctx, { role: 'host', dataDir, dshHome, env: {} })
    expect(probe.registered.map((item) => item.ns)).toEqual([FRIEND_SETTINGS_NAMESPACES.persona])
    dispose()
  })

  it('seeds the default card, publishes presets, asserts resolve, and does not register sections', async () => {
    const { dataDir, dshHome } = await isolatedHomes()
    const ctx = hostCtx()

    const dispose = await apply(ctx, {
      role: 'host',
      dataDir,
      dshHome,
      env: {},
    })

    const seeded = JSON.parse(await readFile(personaFilePath(dataDir, DEFAULT_PERSONA_SLUG), 'utf8')) as {
      name: string
    }
    expect(seeded.name).toBe(DEFAULT_PERSONA.name)
    expect(ctx.resolve).toHaveBeenCalledWith(FRIEND_PRESET_IDS.companion)
    expect(ctx.resolve).toHaveBeenCalledWith(FRIEND_PRESET_IDS.companionPlus)
    expect(ctx.section).not.toHaveBeenCalled()
    expect(ctx.restrict).not.toHaveBeenCalled()

    await expect(stat(join(dshHome, '.agent-presets', 'friend-companion', 'agent.cordis.yml'))).resolves.toBeDefined()
    dispose()
  })

  it('fail-louds when a published preset resolves as broken', async () => {
    const { dataDir, dshHome } = await isolatedHomes()
    const ctx = hostCtx({
      resolve: vi.fn(async () => ({
        id: 'friend-companion',
        broken: 'the composition is not valid YAML',
      })),
    })

    await expect(apply(ctx, {
      role: 'host',
      dataDir,
      dshHome,
      env: {},
    })).rejects.toThrow(/broken/)
  })

  it('wires session deps from ctx.agents / ctx.settings without creating a session', async () => {
    const { dataDir, dshHome } = await isolatedHomes()
    const create = vi.fn()
    const ctx = hostCtx({
      agents: {
        get: () => undefined,
        create,
      },
      settings: {
        get: (namespace) => {
          expect(namespace).toBe(FRIEND_SETTINGS_NAMESPACES.core)
          return {}
        },
        update: vi.fn(async () => undefined),
      },
    })

    const handle = await applyPersona(ctx, { dataDir, dshHome, env: {} })
    expect(handle.sessionDeps).toBeDefined()
    expect(handle.sessionDeps?.registry).toBe(ctx.agents)
    expect(create).not.toHaveBeenCalled()
    handle.dispose()
  })

  it('attaches ctx.on(session/event) to the companion-reply hub', async () => {
    const { dataDir, dshHome } = await isolatedHomes()
    const listeners: Array<(...args: unknown[]) => void> = []
    const ctx = hostCtx({
      agents: {
        get: () => undefined,
        create: vi.fn(),
      },
    })
    const withOn = {
      ...ctx,
      on(event: string, handler: (...args: unknown[]) => void) {
        expect(event).toBe('session/event')
        listeners.push(handler)
        return () => undefined
      },
    }
    const handle = await applyPersona(withOn, { dataDir, dshHome, env: {} })
    const seen: string[] = []
    handle.replies.subscribe((delta) => {
      if (delta.rawDelta.length > 0) seen.push(delta.rawDelta)
    })
    listeners[0]?.(
      { id: 'friend-companion-1', header: { agentPreset: FRIEND_PRESET_IDS.companion } },
      { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '在' } } },
    )
    expect(seen).toEqual(['在'])
    handle.dispose()
  })
})

describe('apply() companion-preset wiring', () => {
  it('registers sections and restrict, and the disposer clears them', async () => {
    const { dataDir, dshHome } = await isolatedHomes()
    const pipeline = new MockPromptPipeline()
    const restrict = vi.fn(() => vi.fn())
    const effect = vi.fn((execute: () => () => void) => execute())
    const prompt = pipeline.context('friend-companion')

    const handle = await applyPersona(
      {
        systemPrompt: prompt.systemPrompt,
        tools: { register: vi.fn(), restrict },
        effect,
      },
      {
        role: 'companion-preset',
        allowlist: 'companion',
        dataDir,
        dshHome,
        env: {},
      },
    )

    expect(restrict).toHaveBeenCalledWith({ allow: [...COMPANION_TOOL_ALLOWLIST] })
    expect(effect).toHaveBeenCalledOnce()
    const assembled = pipeline.assemble('friend-companion')
    expect(assembled.names).toEqual([PERSONA_SECTION_NAME, CONDUCT_SECTION_NAME])

    handle.dispose()
    expect(pipeline.assemble('friend-companion').names).toEqual([])
  })

  it('uses the plus allowlist when configured', async () => {
    const { dataDir, dshHome } = await isolatedHomes()
    const restrict = vi.fn(() => vi.fn())
    await apply(
      {
        systemPrompt: { section: vi.fn(() => vi.fn()) },
        tools: { register: vi.fn(), restrict },
      },
      {
        role: 'companion-preset',
        allowlist: 'plus',
        dataDir,
        dshHome,
        env: {},
      },
    )
    expect(restrict).toHaveBeenCalledWith({ allow: [...PLUS_TOOL_ALLOWLIST] })
  })
})

describe('apply() scope mask through the mock assemble pipeline', () => {
  it('leaves a non-companion assemble empty of friend sections after host apply', async () => {
    const { dataDir, dshHome } = await isolatedHomes()
    const pipeline = new MockPromptPipeline()
    const restrict = vi.fn(() => vi.fn())

    await apply(
      {
        agentPresets: {
          resolve: vi.fn(async (id?: string) => ({ id: id ?? '' })),
          list: vi.fn(async () => []),
        },
        systemPrompt: pipeline.context().systemPrompt,
        tools: { register: vi.fn(), restrict },
      },
      { role: 'host', dataDir, dshHome, env: {} },
    )

    await apply(
      {
        systemPrompt: pipeline.context('friend-companion').systemPrompt,
        tools: { register: vi.fn(), restrict },
      },
      { role: 'companion-preset', allowlist: 'companion', dataDir, dshHome, env: {} },
    )

    const coding = pipeline.assemble('standard')
    expect(coding.names).toEqual([])
    for (const marker of FRIEND_SECTION_MARKERS) {
      expect(coding.text, `coding assemble leaked ${marker}`).not.toContain(marker)
    }
    expect(restrict).toHaveBeenCalledOnce()
    expect(pipeline.assemble('friend-companion').names).toEqual([
      PERSONA_SECTION_NAME,
      CONDUCT_SECTION_NAME,
    ])
  })
})
