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
    expect(formatPluginMountLog('@wishp3/dsh-friend-tts')).toBe(
      `${PLUGIN_MOUNT_LOG_EVENT} @wishp3/dsh-friend-tts`,
    )
  })

  it('emits exactly that line from logPluginMount', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    logPluginMount('@wishp3/dsh-friend-stage')
    expect(info).toHaveBeenCalledOnce()
    expect(info).toHaveBeenCalledWith(formatPluginMountLog('@wishp3/dsh-friend-stage'))
  })
})
