import { describe, expect, it } from 'vitest'

import { FRIEND_GITHUB_RELEASES_PAGE, FRIEND_GITHUB_REPO } from '../src/github-repo.ts'
import {
  createShellHeartbeatStore,
  parseShellHeartbeat,
  projectShellStatus,
  SHELL_ONLINE_WINDOW_MS,
} from '../src/shell-heartbeat.ts'

const CANARY = 'sk-live-CANARY_dsh_friend_shell_heartbeat_e7a2'

describe('shell heartbeat payload', () => {
  it('accepts a tight version / platform / pid object and drops extras', () => {
    const parsed = parseShellHeartbeat({
      version: '0.1.0',
      platform: 'darwin',
      pid: 4242,
      token: CANARY,
      extra: { secret: CANARY },
    })
    expect(parsed).toEqual({
      ok: true,
      value: { version: '0.1.0', platform: 'darwin', pid: 4242 },
    })
  })

  it('rejects missing fields, bad types, and out-of-range pid', () => {
    expect(parseShellHeartbeat(null).ok).toBe(false)
    expect(parseShellHeartbeat('darwin').ok).toBe(false)
    expect(parseShellHeartbeat({ platform: 'darwin', pid: 1 }).ok).toBe(false)
    expect(parseShellHeartbeat({ version: '', platform: 'darwin', pid: 1 }).ok).toBe(false)
    expect(parseShellHeartbeat({ version: '0.1.0', platform: 'android', pid: 1 }).ok).toBe(false)
    expect(parseShellHeartbeat({ version: '0.1.0', platform: 'darwin', pid: 0 }).ok).toBe(false)
    expect(parseShellHeartbeat({ version: '0.1.0', platform: 'darwin', pid: 1.5 }).ok).toBe(false)
    expect(parseShellHeartbeat({ version: 'has space', platform: 'darwin', pid: 1 }).ok).toBe(false)
  })
})

describe('shell online window', () => {
  it('is online inside 90s and offline after, and never projects pid or canaries', () => {
    let now = 1_000_000
    const store = createShellHeartbeatStore({ now: () => now })
    expect(store.isOnline()).toBe(false)
    store.record({ version: CANARY, platform: 'win32', pid: 99 })
    expect(store.isOnline()).toBe(true)
    now += SHELL_ONLINE_WINDOW_MS
    expect(store.isOnline()).toBe(true)
    now += 1
    expect(store.isOnline()).toBe(false)

    const view = projectShellStatus(store, 1_000_000)
    expect(view.online).toBe(true)
    expect(view.connected).toBe(true)
    expect(view.downloadUrl).toBe(FRIEND_GITHUB_RELEASES_PAGE)
    expect(view.downloadUrl).toContain(FRIEND_GITHUB_REPO)
    expect(JSON.stringify(view)).not.toContain(CANARY)
    expect(JSON.stringify(view)).not.toContain('99')
    expect(view).not.toHaveProperty('pid')
    expect(view).not.toHaveProperty('version')
    expect(view).not.toHaveProperty('platform')
  })
})
