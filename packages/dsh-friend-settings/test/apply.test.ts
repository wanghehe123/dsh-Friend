import { describe, expect, it, vi } from 'vitest'

import { createFriendSettingsInstallProbe, FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared'

import { apply, inject, name } from '../src/index.ts'
import {
  FRIEND_SETTINGS_MODELS_TEST_PATH,
  FRIEND_SETTINGS_PATCH_PATH,
  FRIEND_SETTINGS_PERSONA_PATH,
  FRIEND_SETTINGS_SNAPSHOT_PATH,
  FRIEND_SHELL_HEARTBEAT_PATH,
} from '../src/paths.ts'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

describe('settings host apply', () => {
  it('registers friend-core on the production path without an injected schema', () => {
    const probe = createFriendSettingsInstallProbe()
    apply({
      ...probe,
      settings: { get: () => ({}) },
    }, { env: {}, override: '/tmp/dsh-friend-settings-register' })
    expect(probe.registered.map((item) => item.ns)).toEqual([FRIEND_SETTINGS_NAMESPACES.core])
    expect(probe.registered[0]?.schema).toBeDefined()
  })

  it('declares webServer and settings inject so Cordis will not throw', () => {
    expect(name).toBe('@wishp3/dsh-friend-settings')
    expect(inject).toEqual(['webServer', 'settings', 'agentDefaultModel', 'llm'])
  })

  it('registers exact settings routes when webServer is present', () => {
    const routes: WebRoute[] = []
    const effect = vi.fn((execute: () => () => void) => execute())
    apply({
      effect,
      settings: { get: () => ({}) },
      webServer: {
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
    }, { env: {}, override: '/tmp/dsh-friend-settings-apply' })

    expect(routes.some((route) => route.kind === 'exact' && route.path === FRIEND_SETTINGS_SNAPSHOT_PATH)).toBe(true)
    expect(routes.some((route) => route.kind === 'exact' && route.path === FRIEND_SETTINGS_PATCH_PATH)).toBe(true)
    expect(routes.some((route) => route.kind === 'exact' && route.path === FRIEND_SETTINGS_PERSONA_PATH)).toBe(true)
    expect(routes.some((route) => route.kind === 'exact' && route.path === FRIEND_SHELL_HEARTBEAT_PATH)).toBe(true)
    expect(routes.every((route) => route.kind === 'exact' || route.kind === 'prefix')).toBe(true)
    expect(routes.some((route) => route.path.includes(':'))).toBe(false)
  })

  it('wires connection test through ctx.llm.stream instead of a fake inherit ack', async () => {
    const routes: WebRoute[] = []
    apply({
      effect: (execute: () => () => void) => execute(),
      settings: { get: () => ({}) },
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'opencode-go', model: 'deepseek-v4-pro' }),
      },
      llm: {
        listProviders: () => [{ id: 'opencode-go' }],
        async *stream() {
          yield { type: 'text-delta', index: 0, text: 'pong' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
      webServer: {
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
    }, { env: {}, override: '/tmp/dsh-friend-settings-model-test' })

    const found = routes.find((route) => route.path === FRIEND_SETTINGS_MODELS_TEST_PATH)
    expect(found, 'models/test route missing').toBeTruthy()
    const response = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      body: '',
      setHeader(name: string, value: string) {
        this.headers[name.toLowerCase()] = value
      },
      end(body = '') {
        this.body = String(body)
      },
    }
    await found?.handler({
      method: 'POST',
      url: FRIEND_SETTINGS_MODELS_TEST_PATH,
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({ purpose: 'chat', override: '' }))
      },
    } as never, response as never)
    expect(response.body).toContain('"ok":true')
    expect(response.body).toContain('pong')
    expect(response.body).not.toContain('"detail":"inherit"')
  })
})
