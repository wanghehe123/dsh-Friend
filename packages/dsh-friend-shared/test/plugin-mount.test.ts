import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PLUGIN_MOUNT_LOG_EVENT,
  formatPluginMountLog,
  logPluginMount,
} from '../src/plugin-mount.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('plugin mount marker', () => {
  it('formats a single machine-parseable line', () => {
    expect(formatPluginMountLog('@wish233/dsh-friend-tts')).toBe(
      `${PLUGIN_MOUNT_LOG_EVENT} @wish233/dsh-friend-tts`,
    )
  })

  it('emits exactly that line from logPluginMount', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    logPluginMount('@wish233/dsh-friend-stage')
    expect(info).toHaveBeenCalledOnce()
    expect(info).toHaveBeenCalledWith(formatPluginMountLog('@wish233/dsh-friend-stage'))
  })
})
