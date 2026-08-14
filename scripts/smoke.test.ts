import { describe, expect, it } from 'vitest'

import { formatPluginMountLog as sharedFormatPluginMountLog } from '../packages/dsh-friend-shared/src/plugin-mount.ts'
import { formatPresetReadyLog as personaFormatPresetReadyLog } from '../packages/dsh-friend-persona/src/presets.ts'

import {
  FRIEND_PACKAGES,
  FRIEND_PET_PATH,
  FRIEND_PRESET_IDS,
  SMOKE_SKIP_MESSAGE,
  assertPetOk,
  findMissingPluginMounts,
  findMissingPresetReady,
  formatPluginMountLog,
  formatPresetReadyLog,
  killProcessTree,
  parseArgs,
  parseListenAddress,
  renderFriendOverlayPatch,
  resolveSmokePlan,
  waitForHttpOk,
  waitUntil,
} from './smoke.mjs'

describe('parseArgs', () => {
  it('defaults to skip-friendly live smoke', () => {
    expect(parseArgs([])).toMatchObject({
      help: false,
      requireDsh: false,
      useUserHome: false,
      timeoutMs: 60_000,
      profile: 'web',
    })
  })

  it('parses --require-dsh and --port', () => {
    expect(parseArgs(['--require-dsh', '--port', '3411'])).toMatchObject({
      requireDsh: true,
      port: 3411,
    })
  })
})

describe('resolveSmokePlan', () => {
  it('skips with a Chinese explanation when dsh is missing', () => {
    expect(resolveSmokePlan({ dshBin: null, requireDsh: false })).toEqual({
      action: 'skip',
      message: SMOKE_SKIP_MESSAGE,
    })
  })

  it('fails when --require-dsh and dsh is missing', () => {
    expect(resolveSmokePlan({ dshBin: null, requireDsh: true })).toEqual({
      action: 'fail',
      message: 'dsh CLI not found on PATH (--require-dsh).',
    })
  })

  it('runs when a dsh binary is available', () => {
    expect(resolveSmokePlan({ dshBin: '/usr/local/bin/dsh' })).toEqual({ action: 'run' })
  })
})

describe('parseListenAddress', () => {
  it('reads an http://127.0.0.1:port URL', () => {
    expect(parseListenAddress('ready at http://127.0.0.1:3411\n')).toEqual({
      host: '127.0.0.1',
      port: 3411,
      origin: 'http://127.0.0.1:3411',
    })
  })

  it('reads localhost and a labelled port', () => {
    expect(parseListenAddress('Local: http://localhost:8080/')).toMatchObject({ port: 8080 })
    expect(parseListenAddress('listening on port 3099')).toMatchObject({ port: 3099 })
  })

  it('falls back to the port we passed dsh', () => {
    expect(parseListenAddress('plugins applying…', 3500)).toEqual({
      host: '127.0.0.1',
      port: 3500,
      origin: 'http://127.0.0.1:3500',
    })
  })
})

describe('findMissingPluginMounts', () => {
  it('stays aligned with the shared mount helper', () => {
    expect(formatPluginMountLog('@wish233/dsh-friend-tts')).toBe(
      sharedFormatPluginMountLog('@wish233/dsh-friend-tts'),
    )
  })

  it('accepts the official mount line for every package', () => {
    const log = FRIEND_PACKAGES.map((name) => `12:00:00 ${formatPluginMountLog(name)}`).join('\n')
    expect(findMissingPluginMounts(log)).toEqual([])
  })

  it('accepts stage logging its unscoped host name', () => {
    const lines = FRIEND_PACKAGES.map((name) => (
      name === '@wish233/dsh-friend-stage'
        ? formatPluginMountLog('dsh-friend-stage')
        : formatPluginMountLog(name)
    ))
    expect(findMissingPluginMounts(lines.join('\n'))).toEqual([])
  })

  it('reports plugins that never printed the mount line', () => {
    const log = `${formatPluginMountLog('@wish233/dsh-friend-shared')}\nloaded dsh-friend-stage\n`
    expect(findMissingPluginMounts(log)).toContain('@wish233/dsh-friend-persona')
    expect(findMissingPluginMounts(log)).toContain('@wish233/dsh-friend-stage')
    expect(findMissingPluginMounts(log)).not.toContain('@wish233/dsh-friend-shared')
  })

  it('does not treat a leftover apply() role log as a mount line', () => {
    const log = '[@wish233/dsh-friend-persona] apply() role=host\n'
    expect(findMissingPluginMounts(log)).toContain('@wish233/dsh-friend-persona')
  })
})

describe('findMissingPresetReady', () => {
  it('stays aligned with persona host apply() success lines', () => {
    expect(formatPresetReadyLog('friend-companion')).toBe(
      personaFormatPresetReadyLog('friend-companion'),
    )
  })

  it('accepts a ready line for every shipped companion id', () => {
    const log = FRIEND_PRESET_IDS.map((id) => formatPresetReadyLog(id)).join('\n')
    expect(findMissingPresetReady(log)).toEqual([])
  })

  it('reports ids whose resolve-success line never printed', () => {
    const log = `${formatPresetReadyLog('friend-companion')}\n`
    expect(findMissingPresetReady(log)).toEqual(['friend-companion-plus'])
  })

  it('does not treat friend-companion-plus as friend-companion', () => {
    const log = `${formatPresetReadyLog('friend-companion-plus')}\n`
    expect(findMissingPresetReady(log)).toEqual(['friend-companion'])
  })
})

describe('assertPetOk', () => {
  it('accepts 200 and rejects anything else', () => {
    expect(() => assertPetOk(200)).not.toThrow()
    expect(() => assertPetOk(404)).toThrow(new RegExp(`GET ${FRIEND_PET_PATH} 200, got 404`))
  })
})

describe('waitUntil / waitForHttpOk', () => {
  it('resolves once the predicate becomes true', async () => {
    let n = 0
    await waitUntil(() => {
      n += 1
      return n >= 3
    }, { intervalMs: 1, timeoutMs: 200 })
    expect(n).toBe(3)
  })

  it('polls a mock fetch until GET returns 200', async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      if (calls < 3) {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
      }
      return { status: 200 }
    }

    const status = await waitForHttpOk({
      origin: 'http://127.0.0.1:3999',
      path: FRIEND_PET_PATH,
      fetchImpl,
      intervalMs: 1,
      timeoutMs: 500,
    })
    expect(status).toBe(200)
    expect(calls).toBe(3)
  })
})

describe('killProcessTree', () => {
  it('signals the process group first', () => {
    const calls: Array<[number | string, string]> = []
    killProcessTree(4242, {
      kill: (pid, signal) => {
        calls.push([pid, String(signal)])
      },
    })
    expect(calls[0]).toEqual([-4242, 'SIGTERM'])
  })

  it('falls back to the pid when the process group is gone', () => {
    const calls: Array<[number | string, string]> = []
    killProcessTree(7, {
      kill: (pid, signal) => {
        calls.push([pid, String(signal)])
        if (typeof pid === 'number' && pid < 0) {
          throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
        }
      },
    })
    expect(calls).toEqual([
      [-7, 'SIGTERM'],
      [7, 'SIGTERM'],
    ])
  })
})

describe('renderFriendOverlayPatch', () => {
  it('inserts every friend package as a cordis patch row', () => {
    const yaml = renderFriendOverlayPatch()
    expect(yaml.startsWith('- insert:')).toBe(true)
    for (const name of FRIEND_PACKAGES) {
      expect(yaml).toContain(`name: '${name}'`)
    }
  })
})
