import { resolveUiLanguage, type FriendUiLanguage } from '../core-settings.ts'
import { t } from '../i18n.ts'
import { FRIEND_SETTINGS_CHARACTERS_PATH, FRIEND_SETTINGS_SNAPSHOT_PATH } from '../paths.ts'
import {
  createPluginCardForm,
  type PluginCardCharacter,
  type PluginCardForm,
  type SettingsFieldWriter,
} from '../plugin-card.ts'
import { friendReact } from './friend-react.ts'
import { getJson, isRecord } from './http.ts'
import { readFriendSettingsSnapshot } from './settings-patch.ts'

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
  /** Plugin-tab cards start collapsed; the dedicated section page stays open. */
  collapsible?: boolean
}

export function PluginCard(props: PluginCardProps): unknown {
  const { useMemo, useState, useEffect, createElement } = friendReact()
  const [characters, setCharacters] = useState<readonly PluginCardCharacter[] | undefined>(props.characters)
  const [live, setLive] = useState<{ core?: unknown; persona?: unknown; tts?: unknown } | undefined>(undefined)
  useEffect?.(() => {
    void getJson(FRIEND_SETTINGS_CHARACTERS_PATH).then((body) => {
      const next = readPluginCharacters(body)
      if (next.length > 0) {
        setCharacters(next)
      }
    })
    void getJson(FRIEND_SETTINGS_SNAPSHOT_PATH).then((body) => {
      const snapshot = readFriendSettingsSnapshot(body)
      if (snapshot === undefined) {
        return
      }
      setLive({
        core: snapshot.core,
        persona: snapshot.persona,
        tts: snapshot.tts,
      })
    })
  }, [])
  const form = useMemo(
    () => createPluginCardForm({
      core: live?.core ?? props.core,
      persona: live?.persona ?? props.persona,
      ...(live?.tts !== undefined || props.tts !== undefined ? { tts: live?.tts ?? props.tts } : {}),
      ...(characters !== undefined ? { characters } : {}),
      ...(props.coreScope !== undefined ? { coreScope: props.coreScope } : {}),
      ...(props.personaScope !== undefined ? { personaScope: props.personaScope } : {}),
      ...(props.ttsScope !== undefined ? { ttsScope: props.ttsScope } : {}),
    }),
    [props.core, props.persona, props.tts, live, characters, props.coreScope, props.personaScope, props.ttsScope],
  )
  return createElement(PluginCardView, {
    form,
    ...(props.onOpenCenter !== undefined ? { onOpenCenter: props.onOpenCenter } : {}),
    ...(props.systemLanguage !== undefined ? { systemLanguage: props.systemLanguage } : {}),
    collapsible: props.collapsible === true,
  })
}

export function PluginCardView(props: {
  form: PluginCardForm
  onOpenCenter?: () => void
  systemLanguage?: string
  collapsible?: boolean
}): unknown {
  const { useState, createElement: h } = friendReact()
  const [, bump] = useState(0)
  const collapsible = props.collapsible === true
  const [open, setOpen] = useState(!collapsible)
  const draft = props.form.getDraft()
  const lang = resolveUiLanguage(draft.language, props.systemLanguage)
  const childrenOn = props.form.childControlsEnabled()
  const dirty = props.form.isDirty()
  const redraw = (): void => bump((value) => value + 1)
  const title = t('card.title', lang)
  const subtitle = t('card.subtitle', lang)
  const showBody = !collapsible || open

  return h(
    'section',
    {
      className: 'dsh-friend-card',
      'data-testid': 'dsh-friend-plugin-card',
      'data-collapsible': collapsible ? 'true' : 'false',
      'data-open': showBody ? 'true' : 'false',
    },
    collapsible
      ? h('button', {
        type: 'button',
        className: 'dsh-friend-card-header',
        'data-action': 'toggle-card',
        'aria-expanded': open ? 'true' : 'false',
        'aria-label': `${t(open ? 'card.collapse' : 'card.expand', lang)}: ${title}`,
        onClick: () => setOpen(!open),
      },
        h('span', { className: 'dsh-friend-card-head-text' },
          h('span', { className: 'dsh-friend-card-name' }, title),
          h('span', { className: 'dsh-friend-card-desc' }, subtitle),
        ),
        dirty
          ? h('span', { className: 'dsh-friend-card-pending' }, t('card.unsaved', lang))
          : null,
        h('span', {
          className: open ? 'dsh-friend-card-chevron dsh-friend-card-chevron-open' : 'dsh-friend-card-chevron',
          'aria-hidden': 'true',
        }),
      )
      : h('div', { className: 'dsh-friend-card-head' },
        h('h2', null, title),
        h('p', { className: 'dsh-friend-muted' }, subtitle),
      ),
    showBody ? h('div', { className: 'dsh-friend-card-body' },
    h('label', { className: 'dsh-friend-row' },
      h('span', { className: 'dsh-friend-row-text' },
        h('span', { className: 'dsh-friend-row-title' }, t('card.enabled', lang)),
        draft.enabled ? null : h('span', { className: 'dsh-friend-row-desc' }, t('card.disabledHint', lang)),
      ),
      h('input', {
        type: 'checkbox',
        checked: draft.enabled,
        onChange: (event: { target: { checked: boolean } }) => {
          props.form.set('enabled', event.target.checked)
          redraw()
        },
      }),
    ),
    h('label', { className: 'dsh-friend-row' },
      h('span', { className: 'dsh-friend-row-text' },
        h('span', { className: 'dsh-friend-row-title' }, t('card.floatEnabled', lang)),
      ),
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
    h('label', { className: 'dsh-friend-row' },
      h('span', { className: 'dsh-friend-row-text' },
        h('span', { className: 'dsh-friend-row-title' }, t('card.volume', lang)),
      ),
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
      h('span', { className: 'dsh-friend-row-text' },
        h('span', { className: 'dsh-friend-row-title' }, t('card.muted', lang)),
      ),
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
    h('label', { className: 'dsh-friend-row' },
      h('span', { className: 'dsh-friend-row-text' },
        h('span', { className: 'dsh-friend-row-title' }, t('card.character', lang)),
      ),
      h(
        'select',
        {
          className: 'dsh-friend-control',
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
    h('label', { className: 'dsh-friend-row' },
      h('span', { className: 'dsh-friend-row-text' },
        h('span', { className: 'dsh-friend-row-title' }, t('about.language', lang)),
      ),
      h(
        'select',
        {
          className: 'dsh-friend-control',
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
      h('button', {
        type: 'button',
        disabled: !props.form.isDirty(),
        onClick: () => {
          props.form.discard()
          redraw()
        },
      }, t('card.discard', lang)),
      h('button', {
        type: 'button',
        disabled: !props.form.isDirty(),
        onClick: () => {
          void props.form.commit().then(redraw, redraw)
        },
      }, t('card.save', lang)),
      h('button', {
        type: 'button',
        className: 'dsh-friend-btn-primary',
        onClick: () => props.onOpenCenter?.(),
      }, t('card.openCenter', lang)),
    ),
    ) : null,
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
