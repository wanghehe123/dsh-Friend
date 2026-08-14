import { describe, expect, it } from 'vitest'

import { buildModelInheritViews } from '../src/host-models.ts'
import { createModelSectionForm } from '../src/model-form.ts'
import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared'

describe('model section form', () => {
  it('stages three purpose overrides and links them to resolveModel inherit views', async () => {
    const views = await buildModelInheritViews({
      getDefaultModel: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
      getSettings: (namespace) => {
        if (namespace === FRIEND_SETTINGS_NAMESPACES.persona) {
          return { chatModel: 'deepseek-reasoner' }
        }
        return {}
      },
    })

    expect(views).toHaveLength(3)
    const chat = views.find((view) => view.purpose === 'chat')
    expect(chat?.inherited).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(chat?.resolved).toMatchObject({ kind: 'registered', model: 'deepseek-reasoner' })
    expect(JSON.stringify(views)).not.toContain('apiKey')

    const writes: string[] = []
    const form = createModelSectionForm({
      chat: 'deepseek-reasoner',
      summarize: '',
      growth: '',
      inheritViews: views,
      writer: {
        async setChat(value) {
          writes.push(`chat:${value}`)
        },
        async setSummarize(value) {
          writes.push(`summarize:${value}`)
        },
        async setGrowth(value) {
          writes.push(`growth:${value}`)
        },
      },
    })

    expect(form.inheritViews()[0]?.inherited.model).toBe('deepseek-chat')
    form.set('summarize', 'deepseek-chat')
    expect(form.isDirty()).toBe(true)
    await form.commit()
    expect(writes).toEqual(['chat:deepseek-reasoner', 'summarize:deepseek-chat', 'growth:'])
  })
})
