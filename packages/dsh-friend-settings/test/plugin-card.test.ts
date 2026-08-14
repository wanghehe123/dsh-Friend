import { describe, expect, it } from 'vitest'

import { createPluginCardForm } from '../src/plugin-card.ts'

describe('plugin card staged form', () => {
  it('commits and discards independently of the live document', async () => {
    const writes: Array<[string, unknown]> = []
    const form = createPluginCardForm({
      core: { enabled: true, floatEnabled: true, volume: 1, muted: false, language: 'zh' },
      persona: { currentSlug: 'default' },
      coreScope: {
        async set(field, value) {
          writes.push([field, value])
        },
      },
    })

    form.set('volume', 0.4)
    form.set('muted', true)
    expect(form.isDirty()).toBe(true)
    expect(form.getDraft().volume).toBe(0.4)
    expect(form.getCommitted().volume).toBe(1)

    form.discard()
    expect(form.isDirty()).toBe(false)
    expect(form.getDraft().volume).toBe(1)

    form.set('volume', 0.2)
    await form.commit()
    expect(form.isDirty()).toBe(false)
    expect(writes).toContainEqual(['volume', 0.2])
    expect(writes).toContainEqual(['muted', false])
  })

  it('reads mute from friend-tts and writes the unique source on commit', async () => {
    const ttsWrites: Array<[string, unknown]> = []
    const coreWrites: Array<[string, unknown]> = []
    const form = createPluginCardForm({
      core: { enabled: true, floatEnabled: true, volume: 1, muted: false, language: 'zh' },
      tts: { volume: 0.3, muted: true },
      persona: { currentSlug: 'default' },
      ttsScope: {
        async set(field, value) {
          ttsWrites.push([field, value])
        },
      },
      coreScope: {
        async set(field, value) {
          coreWrites.push([field, value])
        },
      },
    })
    expect(form.getDraft().muted).toBe(true)
    expect(form.getDraft().volume).toBe(0.3)
    form.set('muted', false)
    form.set('volume', 0.8)
    await form.commit()
    expect(ttsWrites).toContainEqual(['muted', false])
    expect(ttsWrites).toContainEqual(['volume', 0.8])
    expect(coreWrites).toContainEqual(['muted', false])
    expect(coreWrites).toContainEqual(['volume', 0.8])
  })

  it('disables child controls when the master switch is off', () => {
    const form = createPluginCardForm({
      core: { enabled: true, floatEnabled: true, volume: 1, muted: false },
    })
    expect(form.childControlsEnabled()).toBe(true)
    form.set('enabled', false)
    expect(form.childControlsEnabled()).toBe(false)
    form.set('enabled', true)
    expect(form.childControlsEnabled()).toBe(true)
  })
})
