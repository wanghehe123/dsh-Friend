import { t, type I18nKey } from '../i18n.ts'
import {
  formatHotkeyFromEvent,
  type SectionField,
  type StagedSectionForm,
} from '../section-forms.ts'
import { friendReact } from './friend-react.ts'

export function fieldLabel(
  section: string,
  key: string,
  labels: Record<string, Record<string, I18nKey>>,
  language: 'zh' | 'en',
): string {
  const mapped = labels[section]?.[key]
  return mapped === undefined ? key : t(mapped, language)
}

export function optionLabel(section: string, key: string, value: string, language: 'zh' | 'en'): string {
  const candidate = `${section}.${key}.${value}`
  const translated = t(candidate as I18nKey, language)
  return translated === candidate ? value : translated
}

export function SectionFormView(props: {
  title: string
  section: string
  form: StagedSectionForm<Record<string, unknown>>
  labels: Record<string, Record<string, I18nKey>>
  language: 'zh' | 'en'
  extra?: unknown
}): unknown {
  const { useState, createElement: h } = friendReact()
  const [, bump] = useState(0)
  const redraw = (): void => bump((value) => value + 1)
  return h(
    'div',
    { 'data-section-form': props.section },
    h('h2', null, props.title),
    ...props.form.descriptor().fields.map((field) => h(Control, {
      key: field.key,
      field,
      label: fieldLabel(props.section, field.key, props.labels, props.language),
      section: props.section,
      language: props.language,
      onChange: (value: unknown) => {
        props.form.set(field.key, value)
        redraw()
      },
    })),
    props.extra ?? null,
    h(FormActions, { form: props.form, language: props.language, onDone: redraw }),
  )
}

export function FormActions(props: {
  form: { isDirty(): boolean; commit(): Promise<void>; discard(): void }
  language: 'zh' | 'en'
  onDone: () => void
}): unknown {
  const { createElement: h } = friendReact()
  const dirty = props.form.isDirty()
  return h(
    'div',
    { className: 'dsh-friend-actions' },
    h('button', {
      type: 'button',
      'data-action': 'commit',
      disabled: !dirty,
      onClick: () => {
        void props.form.commit().then(props.onDone)
      },
    }, t('card.save', props.language)),
    h('button', {
      type: 'button',
      'data-action': 'discard',
      disabled: !dirty,
      onClick: () => {
        props.form.discard()
        props.onDone()
      },
    }, t('card.discard', props.language)),
  )
}

function Control(props: {
  field: SectionField
  label: string
  section: string
  language: 'zh' | 'en'
  onChange: (value: unknown) => void
}): unknown {
  const { createElement: h } = friendReact()
  const { field } = props
  if (field.kind === 'toggle') {
    return h('label', { className: 'dsh-friend-row' },
      h('span', null, props.label),
      h('input', {
        type: 'checkbox',
        'data-field': field.key,
        'data-control': 'toggle',
        checked: field.value === true,
        disabled: field.disabled === true,
        onChange: (event: { target: { checked: boolean } }) => {
          props.onChange(event.target.checked)
        },
      }),
    )
  }
  if (field.kind === 'select') {
    const options = field.options ?? []
    return h('label', { className: 'dsh-friend-field' },
      h('span', null, props.label),
      h('select', {
        'data-field': field.key,
        'data-control': 'select',
        value: String(field.value ?? ''),
        disabled: field.disabled === true,
        onChange: (event: { target: { value: string } }) => {
          props.onChange(event.target.value)
        },
      }, ...options.map((option) => h('option', {
        key: option,
        value: option,
      }, optionLabel(props.section, field.key, option, props.language)))),
    )
  }
  if (field.kind === 'range') {
    return h('label', { className: 'dsh-friend-field' },
      h('span', null, `${props.label}: ${String(field.value)}`),
      h('input', {
        type: 'range',
        'data-field': field.key,
        'data-control': 'range',
        min: field.min,
        max: field.max,
        step: field.step,
        value: field.value,
        disabled: field.disabled === true,
        onChange: (event: { target: { value: string } }) => {
          props.onChange(Number(event.target.value))
        },
      }),
    )
  }
  if (field.kind === 'number') {
    return h('label', { className: 'dsh-friend-field' },
      h('span', null, props.label),
      h('input', {
        type: 'number',
        'data-field': field.key,
        'data-control': 'number',
        min: field.min,
        max: field.max,
        step: field.step,
        value: field.value,
        disabled: field.disabled === true,
        onChange: (event: { target: { value: string } }) => {
          props.onChange(Number(event.target.value))
        },
      }),
    )
  }
  if (field.kind === 'secret') {
    const hintKey = props.section === 'asr' ? 'asr.openaiApiKeyHint' : 'tts.openaiApiKeyHint'
    return h('label', { className: 'dsh-friend-field' },
      h('span', null, props.label),
      h('input', {
        type: 'password',
        autocomplete: 'new-password',
        'data-field': field.key,
        'data-control': 'secret',
        value: String(field.value ?? ''),
        placeholder: t(hintKey, props.language),
        disabled: field.disabled === true,
        onChange: (event: { target: { value: string } }) => {
          props.onChange(event.target.value)
        },
      }),
    )
  }
  if (field.kind === 'hotkey') {
    return h(HotkeyControl, {
      field,
      label: props.label,
      language: props.language,
      onChange: props.onChange,
    })
  }
  if (field.kind === 'status') {
    return h('p', {
      className: 'dsh-friend-muted',
      'data-field': field.key,
      'data-control': 'status',
      'data-available': field.value === true ? 'true' : 'false',
    }, `${props.label}: ${String(field.value ?? '')}`)
  }
  return h('label', { className: 'dsh-friend-field' },
    h('span', null, props.label),
    h('input', {
      type: 'text',
      'data-field': field.key,
      'data-control': field.kind,
      value: String(field.value ?? ''),
      disabled: field.disabled === true,
      onChange: (event: { target: { value: string } }) => {
        props.onChange(event.target.value)
      },
    }),
  )
}

function HotkeyControl(props: {
  field: SectionField
  label: string
  language: 'zh' | 'en'
  onChange: (value: unknown) => void
}): unknown {
  const { useState, createElement: h } = friendReact()
  const [recording, setRecording] = useState(false)
  return h('label', { className: 'dsh-friend-field' },
    h('span', null, props.label),
    h('div', { className: 'dsh-friend-hotkey' },
      h('input', {
        type: 'text',
        'data-field': props.field.key,
        'data-control': 'hotkey',
        value: String(props.field.value ?? ''),
        readOnly: recording,
        onChange: (event: { target: { value: string } }) => {
          if (!recording) {
            props.onChange(event.target.value)
          }
        },
        onKeyDown: (event: {
          key: string
          altKey?: boolean
          ctrlKey?: boolean
          metaKey?: boolean
          shiftKey?: boolean
          preventDefault(): void
        }) => {
          if (!recording) {
            return
          }
          event.preventDefault()
          const spec = formatHotkeyFromEvent(event)
          if (spec !== undefined) {
            props.onChange(spec)
            setRecording(false)
          }
        },
      }),
      h('button', {
        type: 'button',
        'data-action': 'record-hotkey',
        onClick: () => setRecording((value) => !value),
      }, t(recording ? 'asr.recordingHotkey' : 'asr.recordHotkey', props.language)),
    ),
  )
}
