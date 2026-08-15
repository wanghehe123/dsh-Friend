import { beforeAll, describe, expect, it } from 'vitest'

import { PluginCardView } from '../src/client-ui/PluginCard.ts'
import { FRIEND_CORE_STAGE_EVENT } from '../src/client-ui/core-stage.ts'
import { createPluginCardForm } from '../src/plugin-card.ts'
import {
  installFakeReact,
  mount,
  queryAll,
  queryByAction,
  rerender,
  type VNode,
} from './fake-react.ts'

function cardForm() {
  return createPluginCardForm({
    core: { enabled: true, floatEnabled: true, volume: 1, muted: false, language: 'zh' },
    persona: { currentSlug: 'default' },
    characters: [{ slug: 'default', name: '小友' }],
  })
}

function renderCard(collapsible: boolean) {
  return mount(() => PluginCardView({
    form: cardForm(),
    collapsible,
  }))
}

function cardRoot(tree: unknown): VNode | undefined {
  return queryAll(tree, (node) => node.props['data-testid'] === 'dsh-friend-plugin-card')[0]
}

describe('plugin card disclosure', () => {
  beforeAll(() => {
    installFakeReact()
  })

  it('keeps the dedicated section page expanded without a disclosure header', () => {
    const tree = renderCard(false)
    const root = cardRoot(tree)
    expect(root?.props['data-collapsible']).toBe('false')
    expect(root?.props['data-open']).toBe('true')
    expect(queryByAction(tree, 'toggle-card')).toBeUndefined()
    expect(queryAll(tree, (node) => node.props.className === 'dsh-friend-card-body')).toHaveLength(1)
  })

  it('starts collapsed on the plugins tab and expands in place', () => {
    const tree = renderCard(true)
    const root = cardRoot(tree)
    expect(root?.props['data-collapsible']).toBe('true')
    expect(root?.props['data-open']).toBe('false')
    expect(queryAll(tree, (node) => node.props.className === 'dsh-friend-card-body')).toHaveLength(0)

    const toggle = queryByAction(tree, 'toggle-card')
    expect(toggle, 'disclosure header missing').toBeTruthy()
    expect(toggle?.props['aria-expanded']).toBe('false')
    ;(toggle?.props.onClick as () => void)()
    const opened = rerender()
    expect(cardRoot(opened)?.props['data-open']).toBe('true')
    expect(queryByAction(opened, 'toggle-card')?.props['aria-expanded']).toBe('true')
    expect(queryAll(opened, (node) => node.props.className === 'dsh-friend-card-body')).toHaveLength(1)
  })

  it('writes the master switch immediately and broadcasts core-stage', async () => {
    const writes: Array<[string, unknown]> = []
    const events: Array<{ type: string; detail?: unknown }> = []
    const previous = globalThis.dispatchEvent
    globalThis.dispatchEvent = ((event: Event) => {
      const custom = event as CustomEvent<unknown>
      events.push({ type: custom.type, detail: custom.detail })
      return true
    }) as typeof dispatchEvent
    try {
      const form = createPluginCardForm({
        core: { enabled: true, floatEnabled: true, volume: 1, muted: false, language: 'zh' },
        persona: { currentSlug: 'default' },
        characters: [{ slug: 'default', name: '小友' }],
        coreScope: {
          async set(field, value) {
            writes.push([field, value])
          },
        },
      })
      const tree = mount(() => PluginCardView({ form, collapsible: false }))
      const enabled = queryAll(tree, (node) => node.props.type === 'checkbox')[0]
      ;(enabled?.props.onChange as (event: { target: { checked: boolean } }) => void)({
        target: { checked: false },
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(form.getDraft().enabled).toBe(false)
      expect(writes).toContainEqual(['enabled', false])
      expect(events).toContainEqual({
        type: FRIEND_CORE_STAGE_EVENT,
        detail: { enabled: false, floatEnabled: true },
      })
    } finally {
      globalThis.dispatchEvent = previous
    }
  })
})
