import { describe, expect, it } from 'vitest'

import {
  applyLiveMute,
  FRIEND_MUTE_EVENT,
  FRIEND_PLAYBACK_GLOBAL,
  FRIEND_TTS_CLIENT_GLOBAL,
  FRIEND_UNMUTE_EVENT,
  installMuteBridge,
  persistPlaybackMute,
  resolvePlaybackKnobs,
} from '../src/mute-bridge.ts'

describe('playback mute source of truth', () => {
  it('prefers friend-tts over core and stage aliases', () => {
    expect(resolvePlaybackKnobs({
      tts: { muted: true, volume: 0.2 },
      core: { muted: false, volume: 1 },
      stage: { floatMuted: false },
    })).toEqual({ muted: true, volume: 0.2 })
    expect(resolvePlaybackKnobs({
      core: { muted: true, volume: 0.5 },
      stage: { floatMuted: false },
    })).toEqual({ muted: true, volume: 0.5 })
    expect(resolvePlaybackKnobs({
      stage: { floatMuted: true },
    })).toEqual({ muted: true, volume: 1 })
  })

  it('writes tts first, then core and stage aliases', async () => {
    const writes: Array<[string, string, unknown]> = []
    await persistPlaybackMute({
      tts: { async set(field, value) { writes.push(['tts', field, value]) } },
      core: { async set(field, value) { writes.push(['core', field, value]) } },
      stage: { async set(field, value) { writes.push(['stage', field, value]) } },
    }, true)
    expect(writes).toEqual([
      ['tts', 'muted', true],
      ['core', 'muted', true],
      ['stage', 'floatMuted', true],
    ])
  })

  it('stops AudioContext and speechSynthesis immediately on mute', () => {
    const stopped: string[] = []
    const media = { paused: false, muted: false, pause() { this.paused = true } }
    const target = {
      [FRIEND_TTS_CLIENT_GLOBAL]: { stopAll() { stopped.push('tts') } },
      speechSynthesis: { cancel() { stopped.push('speech') } },
      document: {
        querySelectorAll() {
          return [media]
        },
      },
    }
    applyLiveMute(true, target)
    expect(stopped).toEqual(['tts', 'speech'])
    expect(media.paused).toBe(true)
    expect(media.muted).toBe(true)
  })

  it('installs a window API and listens for mute events', async () => {
    const writes: Array<[string, unknown]> = []
    const listeners = new Map<string, Array<(event: { type: string }) => void>>()
    const target = {
      addEventListener(type: string, listener: (event: { type: string }) => void) {
        const list = listeners.get(type) ?? []
        list.push(listener)
        listeners.set(type, list)
      },
      removeEventListener(type: string, listener: (event: { type: string }) => void) {
        listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener))
      },
    }
    const dispose = installMuteBridge({
      writers: {
        tts: { async set(field, value) { writes.push([field, value]) } },
      },
      target,
    })
    const api = (target as Record<string, unknown>)[FRIEND_PLAYBACK_GLOBAL] as {
      setMuted(muted: boolean): Promise<void>
      getMuted(): boolean
    }
    expect(api.getMuted()).toBe(false)
    await api.setMuted(true)
    expect(writes).toContainEqual(['muted', true])
    writes.length = 0
    for (const listener of listeners.get(FRIEND_UNMUTE_EVENT) ?? []) {
      listener({ type: FRIEND_UNMUTE_EVENT })
    }
    await Promise.resolve()
    expect(writes).toContainEqual(['muted', false])
    dispose()
    expect((target as Record<string, unknown>)[FRIEND_PLAYBACK_GLOBAL]).toBeUndefined()
    expect(FRIEND_MUTE_EVENT).toBe('dsh-friend:mute')
  })
})
