import { describe, expect, it, vi } from 'vitest'

import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared/universal'

import { FRIEND_TTS_PREVIEW_SENTENCE } from '../src/preview-sentence.ts'
import { createTtsSettingsForm } from '../src/settings-form.ts'
import {
  TTS_SETTINGS_NAMESPACE,
  bindTtsSettings,
  toClientTtsSnapshot,
  type TtsSettingsBinder,
  type TtsSettingsScope,
} from '../src/settings.ts'

function memoryScope(initial: Record<string, unknown> = {}): TtsSettingsScope {
  let value = toClientTtsSnapshot(initial)
  return {
    getSnapshot: () => ({
      status: 'ready',
      value,
      base: initial,
      user: initial,
      revision: 1,
      writable: true,
      mode: 'memory',
    }),
    subscribe: () => () => {},
    set: async (field, next) => {
      value = toClientTtsSnapshot({ ...value, [field]: next })
    },
    unset: async () => {},
  }
}

describe('TTS settings form (W-M2-8)', () => {
  it('binds the kebab friend-tts namespace from shared', () => {
    const bind = vi.fn(() => memoryScope())
    bindTtsSettings({ bind } as TtsSettingsBinder)
    expect(bind.mock.calls[0]?.[0]?.namespace).toBe(FRIEND_SETTINGS_NAMESPACES.tts)
    expect(TTS_SETTINGS_NAMESPACE).toBe('friend-tts')
    expect(TTS_SETTINGS_NAMESPACE).not.toMatch(/\./)
  })

  it('keeps edits staged until commit, and preview uses the draft voice', async () => {
    const scope = memoryScope({ provider: 'edge', voice: 'zh-CN-XiaoxiaoNeural' })
    const previews: string[] = []
    const form = createTtsSettingsForm({
      scope,
      onPreview: (draft) => {
        previews.push(draft.voice)
      },
    })
    expect(form.isDirty()).toBe(false)
    form.set('voice', 'zh-CN-YunxiNeural')
    form.set('rate', 1.25)
    expect(form.isDirty()).toBe(true)
    expect(form.getCommitted().voice).toBe('zh-CN-XiaoxiaoNeural')
    await form.preview()
    expect(previews).toEqual(['zh-CN-YunxiNeural'])
    expect(form.previewSentence()).toBe(FRIEND_TTS_PREVIEW_SENTENCE)
    await form.commit()
    expect(form.isDirty()).toBe(false)
    expect(form.getCommitted().voice).toBe('zh-CN-YunxiNeural')
    expect(form.getCommitted().rate).toBe(1.25)
    form.set('voice', 'en-US-AriaNeural')
    form.discard()
    expect(form.getDraft().voice).toBe('zh-CN-YunxiNeural')
  })

  it('lists catalog voices for the draft provider', () => {
    const form = createTtsSettingsForm({ snapshot: { provider: 'openai-compat', hasApiKey: false } })
    const ids = form.listVoices().map((voice) => voice.id)
    expect(ids).toContain('alloy')
    form.set('provider', 'dashscope')
    expect(form.listVoices().some((voice) => voice.id === 'Cherry')).toBe(true)
    form.set('provider', 'minimax')
    expect(form.listVoices().some((voice) => voice.id === 'male-qn-qingse')).toBe(true)
    form.set('provider', 'edge')
    expect(form.listVoices().some((voice) => voice.id === 'zh-CN-XiaoxiaoNeural')).toBe(true)
  })
})
