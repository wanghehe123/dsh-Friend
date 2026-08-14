import { describe, expect, it } from 'vitest'

import { projectDocuments } from '../src/project.ts'
import { CONFIG_CENTER_SECTIONS } from '../src/sections.ts'
import {
  createAsrSectionForm,
  createFloatSectionForm,
  createTtsSectionForm,
  describeAllSections,
  parseQuietHoursText,
} from '../src/section-forms.ts'
import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared/universal'

describe('ten-section form descriptors', () => {
  it('renders a descriptor for every configuration-center pane', () => {
    const snapshot = projectDocuments({
      [FRIEND_SETTINGS_NAMESPACES.tts]: { provider: 'edge', voice: 'zh-CN-XiaoxiaoNeural' },
      [FRIEND_SETTINGS_NAMESPACES.asr]: { hotkey: 'Alt+Q', mode: 'toggle' },
      [FRIEND_SETTINGS_NAMESPACES.memory]: { distillHour: 5, distillMinute: 30 },
      [FRIEND_SETTINGS_NAMESPACES.reactions]: { level: 'bubble' },
      [FRIEND_SETTINGS_NAMESPACES.stage]: {
        targetFps: 24,
        floatLeft: 8,
        floatTop: 16,
        floatWidth: 300,
        floatHeight: 400,
      },
    })
    const descriptors = describeAllSections(snapshot)
    expect(descriptors.map((item) => item.section)).toEqual([...CONFIG_CENTER_SECTIONS])
    const tts = descriptors.find((item) => item.section === 'tts')
    const asr = descriptors.find((item) => item.section === 'asr')
    const memory = descriptors.find((item) => item.section === 'memory')
    const reactions = descriptors.find((item) => item.section === 'reactions')
    const stage = descriptors.find((item) => item.section === 'stage')
    const float = descriptors.find((item) => item.section === 'float')
    expect(tts?.fields.some((field) => field.key === 'voice' && field.value === 'zh-CN-XiaoxiaoNeural' && field.kind === 'select')).toBe(true)
    expect(asr?.fields.some((field) => field.key === 'hotkey' && field.value === 'Alt+Q' && field.kind === 'hotkey')).toBe(true)
    expect(memory?.fields.some((field) => field.key === 'distillHour' && field.value === 5 && field.kind === 'number')).toBe(true)
    expect(reactions?.fields.some((field) => field.key === 'level' && field.value === 'bubble' && field.kind === 'select')).toBe(true)
    expect(stage?.fields.some((field) => field.key === 'targetFps' && field.value === 24 && field.kind === 'number')).toBe(true)
    expect(float?.fields.some((field) => field.key === 'floatWidth' && field.value === 300 && field.kind === 'number')).toBe(true)
  })

  it('commits TTS and ASR drafts through the namespace writer', async () => {
    const snapshot = projectDocuments({
      [FRIEND_SETTINGS_NAMESPACES.tts]: { voice: 'zh-CN-XiaoxiaoNeural' },
      [FRIEND_SETTINGS_NAMESPACES.asr]: { hotkey: 'Alt+S' },
    })
    const ttsWrites: Array<[string, unknown]> = []
    const asrWrites: Array<[string, unknown]> = []
    const tts = createTtsSectionForm(snapshot.tts, {
      async set(field, value) {
        ttsWrites.push([field, value])
      },
    })
    const asr = createAsrSectionForm(snapshot.asr, {
      async set(field, value) {
        asrWrites.push([field, value])
      },
    })
    tts.set('voice', 'en-US-AriaNeural')
    asr.set('hotkey', 'Alt+Q')
    expect(tts.isDirty()).toBe(true)
    expect(asr.isDirty()).toBe(true)
    await tts.commit()
    await asr.commit()
    expect(ttsWrites).toContainEqual(['voice', 'en-US-AriaNeural'])
    expect(asrWrites).toContainEqual(['hotkey', 'Alt+Q'])
    expect(tts.isDirty()).toBe(false)
  })

  it('exposes openai-compat fields and only writes a typed API key', async () => {
    const snapshot = projectDocuments({
      [FRIEND_SETTINGS_NAMESPACES.tts]: {
        provider: 'openai-compat',
        openaiBaseURL: 'http://127.0.0.1:9/v1',
        openaiModel: 'tts-1',
        openaiApiKey: 'sk-should-never-reach-the-form',
      },
      [FRIEND_SETTINGS_NAMESPACES.asr]: {
        engine: 'endpoint',
        openaiBaseURL: 'http://127.0.0.1:8/v1',
        openaiModel: 'whisper-1',
      },
    })
    const ttsWrites: Array<[string, unknown]> = []
    const asrWrites: Array<[string, unknown]> = []
    const tts = createTtsSectionForm(snapshot.tts, {
      async set(field, value) {
        ttsWrites.push([field, value])
      },
    })
    const asr = createAsrSectionForm(snapshot.asr, {
      async set(field, value) {
        asrWrites.push([field, value])
      },
    })
    expect(tts.getDraft().openaiApiKey).toBe('')
    expect(tts.getDraft().openaiBaseURL).toBe('http://127.0.0.1:9/v1')
    expect(asr.getDraft().openaiApiKey).toBe('')
    expect(tts.descriptor().fields.some((field) => field.key === 'openaiApiKey' && field.kind === 'secret')).toBe(true)
    expect(asr.descriptor().fields.some((field) => field.key === 'openaiBaseURL' && field.value === 'http://127.0.0.1:8/v1')).toBe(true)
    await tts.commit()
    expect(ttsWrites.some(([key]) => key === 'openaiApiKey')).toBe(false)
    tts.set('openaiApiKey', 'sk-new')
    await tts.commit()
    expect(ttsWrites).toContainEqual(['openaiApiKey', 'sk-new'])
    asr.set('openaiApiKey', 'sk-asr')
    await asr.commit()
    expect(asrWrites).toContainEqual(['openaiApiKey', 'sk-asr'])
  })

  it('splits float geometry onto friend-stage and chrome onto friend-core', async () => {
    const snapshot = projectDocuments({
      [FRIEND_SETTINGS_NAMESPACES.core]: { floatEnabled: true, volume: 1, muted: false },
      [FRIEND_SETTINGS_NAMESPACES.stage]: { floatLeft: 1, floatTop: 2, floatWidth: 280, floatHeight: 360 },
    })
    const core: Array<[string, unknown]> = []
    const stage: Array<[string, unknown]> = []
    const tts: Array<[string, unknown]> = []
    const form = createFloatSectionForm(snapshot.core, snapshot.stage, {
      core: {
        async set(field, value) {
          core.push([field, value])
        },
      },
      stage: {
        async set(field, value) {
          stage.push([field, value])
        },
      },
      tts: {
        async set(field, value) {
          tts.push([field, value])
        },
      },
    })
    form.set('floatWidth', 320)
    form.set('volume', 0.4)
    await form.commit()
    expect(tts).toContainEqual(['volume', 0.4])
    expect(core).toContainEqual(['volume', 0.4])
    expect(core.some(([key]) => key === 'floatWidth')).toBe(false)
    expect(stage).toContainEqual(['floatWidth', 320])
    expect(parseQuietHoursText('22:00-07:00, 12:00-13:00')).toEqual([
      { start: '22:00', end: '07:00' },
      { start: '12:00', end: '13:00' },
    ])
  })
})
