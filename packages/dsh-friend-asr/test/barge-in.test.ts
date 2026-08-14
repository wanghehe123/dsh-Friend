import { readFile } from 'node:fs/promises'

import { describe, expect, it, vi } from 'vitest'

import { FRIEND_TTS_STOP_ALL_GLOBAL, invokeFriendTtsStopAll } from '../src/barge-in.ts'
import { startAsrClient } from '../src/client.ts'
import { createFakeEngine } from './helpers/speech-recognition.ts'

describe('ASR barge-in → TTS facade (W-M3-4)', () => {
  it('default onBargeIn calls the TTS stopAll facade once per listening entry', () => {
    const stop = vi.fn()
    const target = globalThis as unknown as Record<string, unknown>
    const previous = target[FRIEND_TTS_STOP_ALL_GLOBAL]
    target[FRIEND_TTS_STOP_ALL_GLOBAL] = stop
    try {
      const fake = createFakeEngine()
      const handle = startAsrClient({ engine: fake.engine })
      handle.session.dispatch({ type: 'hotkey-down' })
      expect(stop).toHaveBeenCalledOnce()
      handle.session.dispatch({ type: 'hotkey-up' })
      handle.session.dispatch({ type: 'hotkey-down' })
      expect(stop).toHaveBeenCalledTimes(2)
      handle.session.setBargeIn(false)
      handle.session.dispatch({ type: 'hotkey-up' })
      handle.session.dispatch({ type: 'hotkey-down' })
      expect(stop).toHaveBeenCalledTimes(2)
      handle.dispose()
    } finally {
      if (previous === undefined) {
        delete target[FRIEND_TTS_STOP_ALL_GLOBAL]
      } else {
        target[FRIEND_TTS_STOP_ALL_GLOBAL] = previous
      }
    }
  })

  it('does not call the facade when onBargeIn is provided as a no-op and bargeIn is off', () => {
    const stop = vi.fn()
    invokeFriendTtsStopAll({ [FRIEND_TTS_STOP_ALL_GLOBAL]: stop })
    expect(stop).toHaveBeenCalledOnce()

    const fake = createFakeEngine()
    const barged = vi.fn()
    const handle = startAsrClient({
      engine: fake.engine,
      onBargeIn: barged,
    })
    handle.session.setBargeIn(false)
    handle.session.dispatch({ type: 'hotkey-down' })
    expect(barged).not.toHaveBeenCalled()
    handle.dispose()
  })
})

describe('TTS stop-all global name contract', () => {
  it('matches the tts package literal so barge-in does not silently miss', async () => {
    const ttsSource = await readFile(
      new URL('../../dsh-friend-tts/src/stop-all.ts', import.meta.url),
      'utf8',
    )
    expect(FRIEND_TTS_STOP_ALL_GLOBAL).toBe('__dshFriendStopAllTts__')
    expect(ttsSource).toContain(`'${FRIEND_TTS_STOP_ALL_GLOBAL}'`)
  })
})

