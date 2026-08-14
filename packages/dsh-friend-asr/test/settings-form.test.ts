import { describe, expect, it } from 'vitest'

import { FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared/universal'

import { resolveAsrEngine } from '../src/engine.ts'
import { inspectEndpointCapabilities } from '../src/engines/endpoint.ts'
import { inspectWebSpeechCapabilities } from '../src/engines/webspeech.ts'
import { createAsrSettingsForm, renderAsrCapabilityCards } from '../src/settings-form.ts'
import { ASR_SETTINGS_NAMESPACE, readFriendAsrSettings } from '../src/settings.ts'
import { createFakeEngine } from './helpers/speech-recognition.ts'
import { createSpeechRecognitionWorld } from './helpers/speech-recognition.ts'

describe('ASR settings + capability cards (W-M3-6)', () => {
  it('uses the kebab friend-asr namespace from shared', () => {
    expect(ASR_SETTINGS_NAMESPACE).toBe(FRIEND_SETTINGS_NAMESPACES.asr)
    expect(ASR_SETTINGS_NAMESPACE).toBe('friend-asr')
    expect(ASR_SETTINGS_NAMESPACE).not.toMatch(/\./)
  })

  it('stages engine/mode/silence/autoSend until commit', async () => {
    const writes: Array<[string, unknown]> = []
    const form = createAsrSettingsForm({
      snapshot: readFriendAsrSettings({}),
      scope: {
        getSnapshot: () => ({
          status: 'ready',
          value: readFriendAsrSettings({}),
          base: {},
          user: {},
          revision: 1,
          writable: true,
          mode: 'memory',
        }),
        subscribe: () => () => {},
        set: async (field, value) => {
          writes.push([field, value])
        },
        unset: async () => {},
      },
    })
    form.set('engine', 'endpoint')
    form.set('mode', 'auto')
    form.set('silenceMs', 800)
    form.set('autoSend', false)
    expect(form.isDirty()).toBe(true)
    expect(form.getCommitted().engine).toBe('auto')
    await form.commit()
    expect(writes).toContainEqual(['engine', 'endpoint'])
    expect(writes).toContainEqual(['mode', 'auto'])
    expect(writes).toContainEqual(['silenceMs', 800])
    expect(writes).toContainEqual(['autoSend', false])
  })

  it('renders green/gray cards for the three capability combinations', () => {
    const chrome = inspectWebSpeechCapabilities({
      SpeechRecognition: createSpeechRecognitionWorld().globals.SpeechRecognition,
      navigator: { userAgent: 'Mozilla/5.0 Chrome/120.0.0.0' },
    })
    const chromeCards = renderAsrCapabilityCards({
      webspeech: chrome,
      endpoint: { available: false, engineId: 'endpoint', reason: 'no mic', interimResults: false, continuous: false },
    })
    expect(chromeCards[0]).toMatchObject({ engineId: 'webspeech', available: true, tone: 'green' })

    const shell = inspectWebSpeechCapabilities({
      navigator: { userAgent: 'Mozilla/5.0 Tauri/2.0 dsh-friend-shell' },
    })
    const shellCards = renderAsrCapabilityCards({
      webspeech: shell,
      endpoint: inspectEndpointCapabilities({}),
    })
    expect(shellCards[0]?.available).toBe(false)
    expect(shellCards[0]?.tone).toBe('gray')
    expect(shellCards[0]?.guidance).toMatch(/endpoint|Chromium/)

    const none = renderAsrCapabilityCards({
      webspeech: { available: false, engineId: 'webspeech', reason: 'missing', interimResults: false, continuous: false },
      endpoint: { available: false, engineId: 'endpoint', reason: 'missing', interimResults: false, continuous: false },
    })
    expect(none[1]?.guidance).toMatch(/本地识别|端点/)
  })

  it('auto-selects webspeech then endpoint', () => {
    const down = createFakeEngine().engine
    down.capabilities = () => ({
      available: false,
      engineId: 'webspeech',
      reason: 'down',
      interimResults: false,
      continuous: false,
    })
    const up = createFakeEngine().engine
    up.capabilities = () => ({
      available: true,
      engineId: 'endpoint',
      interimResults: false,
      continuous: false,
    })
    expect(resolveAsrEngine('auto', [down, up]).engineId).toBe('endpoint')
    expect(resolveAsrEngine('webspeech', [down, up]).engineId).toBe('endpoint')
    expect(resolveAsrEngine('endpoint', [down, up]).engineId).toBe('endpoint')
    expect(resolveAsrEngine('auto', [down]).engine).toBeUndefined()
  })
})
