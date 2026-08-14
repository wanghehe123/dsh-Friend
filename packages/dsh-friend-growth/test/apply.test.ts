import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createFriendSettingsInstallProbe,
  createStrictCordisCtx,
  FRIEND_SETTINGS_NAMESPACES,
} from '@wishp3/dsh-friend-shared'

import { applyGrowth, inject, name, type FriendGrowthContext } from '../src/index.ts'
import { tempDataDir } from './helpers/tmp.ts'

describe('cordis inject', () => {
  it('declares the services apply() may read', () => {
    expect(inject).toEqual(['webServer', 'settings', 'agentDefaultModel', 'llm'])
    expect(name).toBe('@wishp3/dsh-friend-growth')
  })
})

describe('apply() role split', () => {
  it('registers friend-growth on the production host path', async () => {
    const dataDir = await tempDataDir()
    const probe = createFriendSettingsInstallProbe()
    const handle = applyGrowth(
      { ...probe },
      { role: 'host', dataDir, env: {}, completePrompt: async () => '{}' },
    )
    expect(probe.registered.map((item) => item.ns)).toEqual([FRIEND_SETTINGS_NAMESPACES.growth])
    handle.dispose()
  })

  it('host apply mounts growth routes and does not need companion tools', async () => {
    const dataDir = await tempDataDir()
    const routes: Array<{ path: string }> = []
    const handle = applyGrowth(
      {
        webServer: {
          register(route) {
            routes.push(route)
            return () => undefined
          },
        },
        effect: (execute) => execute(),
      },
      { role: 'host', dataDir, env: {}, completePrompt: async () => '{}' },
    )
    expect(handle.role).toBe('host')
    expect(routes.some((item) => item.path === '/friend/growth')).toBe(true)
    expect(routes.some((item) => item.path === '/friend/growth/generate')).toBe(true)
    expect(routes.some((item) => item.path === '/friend/growth/commit')).toBe(true)
    handle.dispose()
  })

  it('companion-preset apply does not register host routes', async () => {
    const dataDir = await tempDataDir()
    const routes: Array<{ path: string }> = []
    const handle = applyGrowth(
      {
        webServer: {
          register(route) {
            routes.push(route)
            return () => undefined
          },
        },
        effect: (execute) => execute(),
      },
      { role: 'companion-preset', dataDir, env: {} },
    )
    expect(handle.role).toBe('companion-preset')
    expect(routes).toEqual([])
  })

  it('re-reads persona currentSlug after apply() and keeps the old directory', async () => {
    const dataDir = await tempDataDir()
    const persona = { currentSlug: 'alice' }
    const handle = applyGrowth(
      {
        settings: {
          get(namespace) {
            return namespace === FRIEND_SETTINGS_NAMESPACES.persona ? persona : undefined
          },
        },
      },
      { role: 'host', dataDir, env: {}, completePrompt: async () => '{}' },
    )
    expect(handle.store.slug).toBe('alice')
    await handle.store.writeProfile({
      characterId: 'alice',
      baseAttributes: '{}',
      worldSetting: '',
      lifeStorySummary: 'alice-story',
      status: 'drafting',
      language: '中文',
    })
    persona.currentSlug = 'bob'
    expect(handle.store.slug).toBe('bob')
    await handle.store.writeProfile({
      characterId: 'bob',
      baseAttributes: '{}',
      worldSetting: '',
      lifeStorySummary: 'bob-story',
      status: 'drafting',
      language: '中文',
    })
    const alice = JSON.parse(await readFile(join(dataDir, 'characters/alice/growth/profile.json'), 'utf8')) as {
      lifeStorySummary: string
    }
    const bob = JSON.parse(await readFile(join(dataDir, 'characters/bob/growth/profile.json'), 'utf8')) as {
      lifeStorySummary: string
    }
    expect(alice.lifeStorySummary).toBe('alice-story')
    expect(bob.lifeStorySummary).toBe('bob-story')
    handle.dispose()
  })
})

function hostCtx(values: Record<string, unknown> = {}): FriendGrowthContext {
  return createStrictCordisCtx({
    inject,
    values: {
      effect: (execute: () => () => void) => execute(),
      ...values,
    },
  }) as FriendGrowthContext
}

function jsonResponse(): {
  statusCode: number
  headers: Record<string, string>
  body: string
  setHeader: (name: string, value: string) => void
  end: (body?: string) => void
} {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(body = '') {
      this.body += String(body)
    },
  }
}

describe('host production LLM path', () => {
  it('generate route default path calls ctx.llm.stream() and does not hit the old stub', async () => {
    const dataDir = await tempDataDir()
    const seen: unknown[] = []
    const routes: Array<{ path: string; handler: (request: unknown, response: unknown) => unknown }> = []
    const llm = {
      listProviders: () => [{ id: 'deepseek' }],
      async *stream(options: unknown) {
        seen.push(options)
        yield {
          type: 'finish',
          reason: { kind: 'error', failure: { code: 'AUTH', message: 'API key is missing' } },
        }
      },
    }
    const handle = applyGrowth(
      hostCtx({
        llm,
        agentDefaultModel: {
          currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
        },
        webServer: {
          register(route: { path: string; handler: (request: unknown, response: unknown) => unknown }) {
            routes.push(route)
            return () => undefined
          },
        },
      }),
      { role: 'host', dataDir, env: {} },
    )
    const generate = routes.find((route) => route.path === '/friend/growth/generate')
    expect(generate).toBeDefined()
    const response = jsonResponse()
    await generate?.handler(
      {
        method: 'POST',
        url: '/friend/growth/generate',
        async *[Symbol.asyncIterator]() {
          yield JSON.stringify({ language: '中文' })
        },
      },
      response,
    )
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).toMatchObject({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(response.body).toMatch(/dsh-llm AUTH: API key is missing/)
    expect(response.body).not.toMatch(/completePrompt seam|refusing to call a live model/)
    handle.dispose()
  })

  it('missing ctx.llm is a service-missing error, not the live-model refusal stub', async () => {
    const dataDir = await tempDataDir()
    const routes: Array<{ path: string; handler: (request: unknown, response: unknown) => unknown }> = []
    const handle = applyGrowth(
      hostCtx({
        webServer: {
          register(route: { path: string; handler: (request: unknown, response: unknown) => unknown }) {
            routes.push(route)
            return () => undefined
          },
        },
      }),
      { role: 'host', dataDir, env: {} },
    )
    const generate = routes.find((route) => route.path === '/friend/growth/generate')
    const response = jsonResponse()
    await generate?.handler(
      {
        method: 'POST',
        url: '/friend/growth/generate',
        async *[Symbol.asyncIterator]() {
          yield JSON.stringify({ language: '中文' })
        },
      },
      response,
    )
    expect(response.body).toMatch(/ctx\.llm is missing; cannot call LlmRuntime\.stream/)
    expect(response.body).not.toMatch(/completePrompt seam|refusing to call a live model/)
    handle.dispose()
  })
})
