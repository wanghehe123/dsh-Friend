import { resolveUiLanguage, type FriendUiLanguage } from '../core-settings.ts'
import { t } from '../i18n.ts'
import { FRIEND_SETTINGS_CHARACTERS_PATH } from '../paths.ts'
import {
  createPluginCardForm,
  type PluginCardCharacter,
  type PluginCardForm,
  type SettingsFieldWriter,
} from '../plugin-card.ts'
import { friendReact } from './friend-react.ts'
import { getJson, isRecord } from './http.ts'

export type PluginCardProps = {
  close?: () => void
  core?: unknown
  persona?: unknown
  tts?: unknown
  characters?: readonly PluginCardCharacter[]
  coreScope?: SettingsFieldWriter
  personaScope?: SettingsFieldWriter
  ttsScope?: SettingsFieldWriter
  onOpenCenter?: () => void
  systemLanguage?: string
}

export function PluginCard(props: PluginCardProps): unknown {
  const { useMemo, useState, useEffect, createElement } = friendReact()
  const [characters, setCharacters] = useState<readonly PluginCardCharacter[] | undefined>(props.characters)
  useEffect?.(() => {
    void getJson(FRIEND_SETTINGS_CHARACTERS_PATH).then((body) => {
      const next = readPluginCharacters(body)
      if (next.length > 0) {
        setCharacters(next)
      }
    })
  }, [])
  const form = useMemo(
    () => createPluginCardForm({
      core: props.core,
      persona: props.persona,
      ...(props.tts !== undefined ? { tts: props.tts } : {}),
      ...(characters !== undefined ? { characters } : {}),
      ...(props.coreScope !== undefined ? { coreScope: props.coreScope } : {}),
      ...(props.personaScope !== undefined ? { personaScope: props.personaScope } : {}),
      ...(props.ttsScope !== undefined ? { ttsScope: props.ttsScope } : {}),
    }),
    [props.core, props.persona, props.tts, characters, props.coreScope, props.personaScope, props.ttsScope],
  )
  return createElement(PluginCardView, {
    form,
    ...(props.onOpenCenter !== undefined ? { onOpenCenter: props.onOpenCenter } : {}),
    ...(props.systemLanguage !== undefined ? { systemLanguage: props.systemLanguage } : {}),
  })
}

export function PluginCardView(props: {
  form: PluginCardForm
  onOpenCenter?: () => void
  systemLanguage?: string
}): unknown {
  const { useState, createElement: h } = friendReact()
  const [, bump] = useState(0)
  const draft = props.form.getDraft()
  const lang = resolveUiLanguage(draft.language, props.systemLanguage)
  const childrenOn = props.form.childControlsEnabled()
  const redraw = (): void => bump((value) => value + 1)

  return h(
    'section',
    { className: 'dsh-friend-card', 'data-testid': 'dsh-friend-plugin-card' },
    h('div', null,
      h('h2', null, t('card.title', lang)),
      h('p', { className: 'dsh-friend-muted' }, t('card.subtitle', lang)),
    ),
    h('label', { className: 'dsh-friend-row' },
      h('span', null, t('card.enabled', lang)),
      h('input', {
        type: 'checkbox',
        checked: draft.enabled,
        onChange: (event: { target: { checked: boolean } }) => {
          props.form.set('enabled', event.target.checked)
          redraw()
        },
      }),
    ),
    draft.enabled ? null : h('p', { className: 'dsh-friend-muted' }, t('card.disabledHint', lang)),
    h('label', { className: 'dsh-friend-row' },
      h('span', null, t('card.floatEnabled', lang)),
      h('input', {
        type: 'checkbox',
        disabled: !childrenOn,
        checked: draft.floatEnabled,
        onChange: (event: { target: { checked: boolean } }) => {
          props.form.set('floatEnabled', event.target.checked)
          redraw()
        },
      }),
    ),
    h('label', { className: 'dsh-friend-field' },
      h('span', null, t('card.volume', lang)),
      h('input', {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.05,
        disabled: !childrenOn || draft.muted,
        value: draft.volume,
        onChange: (event: { target: { value: string } }) => {
          props.form.set('volume', Number(event.target.value))
          redraw()
        },
      }),
    ),
    h('label', { className: 'dsh-friend-row' },
      h('span', null, t('card.muted', lang)),
      h('input', {
        type: 'checkbox',
        disabled: !childrenOn,
        checked: draft.muted,
        onChange: (event: { target: { checked: boolean } }) => {
          props.form.set('muted', event.target.checked)
          redraw()
        },
      }),
    ),
    h('label', { className: 'dsh-friend-field' },
      h('span', null, t('card.character', lang)),
      h(
        'select',
        {
          disabled: !childrenOn,
          value: draft.currentSlug,
          onChange: (event: { target: { value: string } }) => {
            props.form.set('currentSlug', event.target.value)
            redraw()
          },
        },
        ...props.form.characters().map((character) => h('option', {
          key: character.slug,
          value: character.slug,
        }, character.name)),
      ),
    ),
    h('label', { className: 'dsh-friend-field' },
      h('span', null, t('about.language', lang)),
      h(
        'select',
        {
          value: draft.language,
          onChange: (event: { target: { value: string } }) => {
            props.form.set('language', event.target.value as FriendUiLanguage)
            redraw()
          },
        },
        h('option', { value: 'system' }, 'system'),
        h('option', { value: 'zh' }, 'zh'),
        h('option', { value: 'en' }, 'en'),
      ),
    ),
    h('div', { className: 'dsh-friend-actions' },
      h('button', { type: 'button', onClick: () => props.onOpenCenter?.() }, t('card.openCenter', lang)),
      h('button', {
        type: 'button',
        disabled: !props.form.isDirty(),
        onClick: () => {
          void props.form.commit().then(redraw)
        },
      }, t('card.save', lang)),
      h('button', {
        type: 'button',
        disabled: !props.form.isDirty(),
        onClick: () => {
          props.form.discard()
          redraw()
        },
      },       t('card.discard', lang)),
    ),
  )
}

function readPluginCharacters(body: unknown): PluginCardCharacter[] {
  if (!isRecord(body) || !Array.isArray(body.characters)) {
    return []
  }
  const characters: PluginCardCharacter[] = []
  for (const item of body.characters) {
    if (typeof item === 'string' && item.trim().length > 0) {
      characters.push({ slug: item.trim(), name: item.trim() })
      continue
    }
    if (!isRecord(item) || typeof item.slug !== 'string' || item.slug.trim().length === 0) {
      continue
    }
    const slug = item.slug.trim()
    const name = typeof item.name === 'string' && item.name.trim().length > 0 ? item.name.trim() : slug
    characters.push({ slug, name })
  }
  return characters
}
