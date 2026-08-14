import { describe, expect, it, vi } from 'vitest'

import { createFriendSettingsInstallProbe, FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared'

import { apply, inject, name } from '../src/index.ts'
import { FRIEND_SETTINGS_PATCH_PATH, FRIEND_SETTINGS_SNAPSHOT_PATH, FRIEND_SHELL_HEARTBEAT_PATH } from '../src/paths.ts'
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
    expect(name).toBe('@wish233/dsh-friend-settings')
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
    expect(routes.some((route) => route.kind === 'exact' && route.path === FRIEND_SHELL_HEARTBEAT_PATH)).toBe(true)
    expect(routes.every((route) => route.kind === 'exact' || route.kind === 'prefix')).toBe(true)
    expect(routes.some((route) => route.path.includes(':'))).toBe(false)
  })
})
