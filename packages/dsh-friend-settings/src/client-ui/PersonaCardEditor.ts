import { t } from '../i18n.ts'
import { FRIEND_SETTINGS_PERSONA_PATH } from '../paths.ts'
import { friendReact } from './friend-react.ts'
import { getJson, isRecord, postJson } from './http.ts'

export type PersonaCardDraft = {
  slug: string
  name: string
  nickname: string
  language: string
  personality: string
  background: string
  speakingStyle: string
  greetings: string
}

const EMPTY: PersonaCardDraft = {
  slug: 'default',
  name: '',
  nickname: '你',
  language: 'zh-CN',
  personality: '',
  background: '',
  speakingStyle: '',
  greetings: '',
}

export type PersonaCardHandle = {
  isDirty(): boolean
  commit(): Promise<void>
  discard(): void
}

export function PersonaCardEditor(props: {
  language: 'zh' | 'en'
  slug: string
  onBind?: (handle: PersonaCardHandle) => void
}): unknown {
  const { useEffect, useState, createElement: h } = friendReact()
  const [draft, setDraft] = useState<PersonaCardDraft>({ ...EMPTY, slug: props.slug })
  const [loaded, setLoaded] = useState<PersonaCardDraft>({ ...EMPTY, slug: props.slug })
  const [status, setStatus] = useState('')

  const persist = (next: PersonaCardDraft): Promise<void> => {
    setStatus(t('persona.saving', props.language))
    return postJson(FRIEND_SETTINGS_PERSONA_PATH, {
      slug: next.slug,
      name: next.name,
      nickname: next.nickname,
      language: next.language,
      personality: next.personality,
      background: next.background,
      speakingStyle: next.speakingStyle,
      greetings: next.greetings.split('\n').map((line) => line.trim()).filter((line) => line.length > 0),
    }).then((body) => {
      if (isRecord(body) && body.ok === true) {
        setLoaded(next)
        setStatus(t('persona.cardSaved', props.language))
        return
      }
      setStatus(t('persona.cardFail', props.language))
    })
  }

  useEffect?.(() => {
    void getJson(`${FRIEND_SETTINGS_PERSONA_PATH}?slug=${encodeURIComponent(props.slug)}`).then((body) => {
      const next = readPersonaDraft(body, props.slug)
      if (next !== undefined) {
        setDraft(next)
        setLoaded(next)
        setStatus('')
      }
    })
  }, [props.slug])

  useEffect?.(() => {
    props.onBind?.({
      isDirty: () => JSON.stringify(draft) !== JSON.stringify(loaded),
      commit: () => persist(draft),
      discard: () => {
        setDraft(loaded)
        setStatus('')
      },
    })
  }, [draft, loaded, props.language, props.slug])

  const setField = <K extends keyof PersonaCardDraft>(field: K, value: PersonaCardDraft[K]): void => {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  return h('div', { className: 'dsh-friend-card-body', 'data-field': 'personaCard' },
    h('p', { className: 'dsh-friend-muted' }, t('persona.hint', props.language)),
    h(CardField, {
      field: 'name',
      label: t('persona.name', props.language),
      value: draft.name,
      onChange: (value: string) => setField('name', value),
    }),
    h(CardField, {
      field: 'nickname',
      label: t('persona.nickname', props.language),
      value: draft.nickname,
      onChange: (value: string) => setField('nickname', value),
    }),
    h(CardField, {
      field: 'language',
      label: t('persona.language', props.language),
      value: draft.language,
      onChange: (value: string) => setField('language', value),
    }),
    h(CardField, {
      field: 'personality',
      label: t('persona.personality', props.language),
      value: draft.personality,
      multiline: true,
      onChange: (value: string) => setField('personality', value),
    }),
    h(CardField, {
      field: 'background',
      label: t('persona.background', props.language),
      value: draft.background,
      multiline: true,
      onChange: (value: string) => setField('background', value),
    }),
    h(CardField, {
      field: 'speakingStyle',
      label: t('persona.speakingStyle', props.language),
      value: draft.speakingStyle,
      multiline: true,
      onChange: (value: string) => setField('speakingStyle', value),
    }),
    h(CardField, {
      field: 'greetings',
      label: t('persona.greetings', props.language),
      value: draft.greetings,
      multiline: true,
      onChange: (value: string) => setField('greetings', value),
    }),
    status.length > 0
      ? h('p', { className: 'dsh-friend-muted', 'data-field': 'personaCardStatus' }, status)
      : null,
  )
}

function CardField(props: {
  field: string
  label: string
  value: string
  multiline?: boolean
  onChange: (value: string) => void
}): unknown {
  const { createElement: h } = friendReact()
  return h('label', { className: 'dsh-friend-field' },
    h('span', null, props.label),
    h(props.multiline === true ? 'textarea' : 'input', {
      ...(props.multiline === true ? {} : { type: 'text' }),
      'data-field': props.field,
      'data-control': props.multiline === true ? 'textarea' : 'text',
      value: props.value,
      onChange: (event: { target: { value: string } }) => {
        props.onChange(event.target.value)
      },
    }),
  )
}

function readPersonaDraft(body: unknown, fallbackSlug: string): PersonaCardDraft | undefined {
  if (!isRecord(body) || !isRecord(body.persona)) {
    return undefined
  }
  const card = body.persona
  const greetings = Array.isArray(card.greetings)
    ? card.greetings.filter((item): item is string => typeof item === 'string').join('\n')
    : ''
  return {
    slug: typeof card.slug === 'string' && card.slug.length > 0 ? card.slug : fallbackSlug,
    name: asText(card.name),
    nickname: asText(card.nickname) || '你',
    language: asText(card.language) || 'zh-CN',
    personality: asText(card.personality),
    background: asText(card.background),
    speakingStyle: asText(card.speakingStyle),
    greetings,
  }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
