import { describe, expect, it, vi } from 'vitest'

import { FRIEND_SETTINGS_NAMESPACES } from '../src/compat/namespaces.ts'
import { readDefaultModelSelection } from '../src/compat/llm.ts'
import {
  MODEL_OVERRIDE_FIELDS,
  resolveModel,
  type ResolveModelDeps,
} from '../src/model-select.ts'

const DEFAULT = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  reasoningEffort: 'high',
} as const

function deps(overrides: Partial<ResolveModelDeps> & {
  settings?: Record<string, Record<string, unknown>>
} = {}): ResolveModelDeps & { warn: ReturnType<typeof vi.fn> } {
  const warn = overrides.warn ?? vi.fn()
  const settings = overrides.settings ?? {}
  return {
    getDefaultModel: overrides.getDefaultModel ?? (() => DEFAULT),
    getSettings: overrides.getSettings ?? ((namespace) => settings[namespace]),
    catalog: overrides.catalog,
    warn,
  }
}

describe('MODEL_OVERRIDE_FIELDS', () => {
  it('maps each purpose to a kebab namespace and the documented field', () => {
    expect(MODEL_OVERRIDE_FIELDS.chat).toEqual({
      namespace: FRIEND_SETTINGS_NAMESPACES.persona,
      key: 'chatModel',
    })
    expect(MODEL_OVERRIDE_FIELDS.summarize).toEqual({
      namespace: FRIEND_SETTINGS_NAMESPACES.memory,
      key: 'summarizeModel',
    })
    expect(MODEL_OVERRIDE_FIELDS.growth).toEqual({
      namespace: FRIEND_SETTINGS_NAMESPACES.growth,
      key: 'model',
    })
    expect(FRIEND_SETTINGS_NAMESPACES.persona).toBe('friend-persona')
    expect(FRIEND_SETTINGS_NAMESPACES.memory).toBe('friend-memory')
    expect(FRIEND_SETTINGS_NAMESPACES.growth).toBe('friend-growth')
    for (const field of Object.values(MODEL_OVERRIDE_FIELDS)) {
      expect(field.namespace).not.toContain('.')
    }
  })
})

describe('resolveModel', () => {
  it('inherits the dsh default for chat, summarize, and growth when nothing is set', async () => {
    const source = deps()
    const expected = {
      kind: 'registered',
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
    }

    await expect(resolveModel('chat', source)).resolves.toEqual(expected)
    await expect(resolveModel('summarize', source)).resolves.toEqual(expected)
    await expect(resolveModel('growth', source)).resolves.toEqual(expected)
    expect(source.warn).not.toHaveBeenCalled()
  })

  it('uses a chat registered-id override and leaves summarize on the dsh default', async () => {
    const source = deps({
      settings: {
        'friend-persona': { chatModel: 'deepseek-chat' },
        'friend-memory': { summarizeModel: 'cheap-summary' },
      },
      catalog: {
        listProviders: () => [{ id: 'deepseek' }],
        listModels: (provider) =>
          provider === 'deepseek'
            ? [{ id: 'deepseek-chat' }, { id: 'cheap-summary' }]
            : [],
      },
    })

    await expect(resolveModel('chat', source)).resolves.toEqual({
      kind: 'registered',
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    await expect(resolveModel('summarize', source)).resolves.toEqual({
      kind: 'registered',
      provider: 'deepseek',
      model: 'cheap-summary',
    })
    await expect(resolveModel('growth', source)).resolves.toEqual({
      kind: 'registered',
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
    })
  })

  it('accepts an openai-compat object for summarize', async () => {
    const source = deps({
      settings: {
        'friend-memory': {
          summarizeModel: {
            baseURL: 'https://llm.example/v1',
            model: 'gpt-4o-mini',
            apiKey: 'sk-test',
            api: 'openai',
          },
        },
      },
    })

    await expect(resolveModel('summarize', source)).resolves.toEqual({
      kind: 'openai-compat',
      baseURL: 'https://llm.example/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
      api: 'openai',
    })
    expect(source.warn).not.toHaveBeenCalled()
  })

  it('accepts a {provider,model} object for growth', async () => {
    const source = deps({
      settings: {
        'friend-growth': {
          model: { provider: 'deepseek', model: 'deepseek-reasoner' },
        },
      },
    })

    await expect(resolveModel('growth', source)).resolves.toEqual({
      kind: 'registered',
      provider: 'deepseek',
      model: 'deepseek-reasoner',
    })
  })

  it('falls back and warns on empty, non-object, and malformed overrides', async () => {
    const empty = deps({
      settings: { 'friend-persona': { chatModel: '   ' } },
    })
    await expect(resolveModel('chat', empty)).resolves.toMatchObject({
      kind: 'registered',
      model: 'deepseek-chat',
    })
    expect(empty.warn).toHaveBeenCalledWith(expect.stringMatching(/illegal chat model override/))

    const numeric = deps({
      settings: { 'friend-memory': { summarizeModel: 12 } },
    })
    await expect(resolveModel('summarize', numeric)).resolves.toMatchObject({
      kind: 'registered',
      model: 'deepseek-chat',
    })
    expect(numeric.warn).toHaveBeenCalledWith(
      expect.stringMatching(/illegal summarize model override/),
    )

    const brokenObject = deps({
      settings: { 'friend-growth': { model: { baseURL: 'not-a-url', model: 'x' } } },
    })
    await expect(resolveModel('growth', brokenObject)).resolves.toMatchObject({
      kind: 'registered',
      model: 'deepseek-chat',
    })
    expect(brokenObject.warn).toHaveBeenCalledWith(
      expect.stringMatching(/illegal growth model override/),
    )
  })

  it('rejects a model id that is not in the registered catalog', async () => {
    const source = deps({
      settings: { 'friend-persona': { chatModel: 'no-such-model' } },
      catalog: {
        listProviders: () => [{ id: 'deepseek' }],
        listModels: () => [{ id: 'deepseek-chat' }],
      },
    })

    await expect(resolveModel('chat', source)).resolves.toMatchObject({
      kind: 'registered',
      model: 'deepseek-chat',
    })
    expect(source.warn).toHaveBeenCalledWith(
      expect.stringMatching(/not in the registered catalog/),
    )
  })
})

describe('readDefaultModelSelection', () => {
  it('delegates to ctx.agentDefaultModel.currentSelection', () => {
    const currentSelection = vi.fn(() => DEFAULT)
    expect(readDefaultModelSelection({
      agentDefaultModel: { currentSelection },
    })).toEqual(DEFAULT)
    expect(currentSelection).toHaveBeenCalledOnce()
  })
})
