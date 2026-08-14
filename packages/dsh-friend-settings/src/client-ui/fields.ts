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

export function fieldLabelFor(
  field: SectionField,
  section: string,
  labels: Record<string, Record<string, I18nKey>>,
  language: 'zh' | 'en',
): string {
  if (field.labelKey !== undefined) {
    return t(field.labelKey as I18nKey, language)
  }
  return fieldLabel(section, field.key, labels, language)
}

export function optionLabel(section: string, key: string, value: string, language: 'zh' | 'en'): string {
  const candidate = `${section}.${key}.${value}`
  const translated = t(candidate as I18nKey, language)
  return translated === candidate ? value : translated
}

export type ExtraFormActions = {
  isDirty(): boolean
  commit(): Promise<void>
  discard(): void
}

export function SectionFormView(props: {
  title: string
  section: string
  form: StagedSectionForm<Record<string, unknown>>
  labels: Record<string, Record<string, I18nKey>>
  language: 'zh' | 'en'
  extra?: unknown
  extraCommit?: ExtraFormActions
}): unknown {
  const { useState, createElement: h } = friendReact()
  const [, bump] = useState(0)
  const redraw = (): void => bump((value) => value + 1)
  return h(
    'div',
    { 'data-section-form': props.section },
    h('h2', { className: 'dsh-friend-pane-title' }, props.title),
    ...props.form.descriptor().fields.map((field) => h(Control, {
      key: field.key,
      field,
      label: fieldLabelFor(field, props.section, props.labels, props.language),
      section: props.section,
      language: props.language,
      onChange: (value: unknown) => {
        props.form.set(field.key, value)
        redraw()
      },
    })),
    props.extra ?? null,
    h(FormActions, {
      form: combineFormActions(props.form, props.extraCommit),
      language: props.language,
      onDone: redraw,
    }),
  )
}

function combineFormActions(
  form: ExtraFormActions,
  extra: ExtraFormActions | undefined,
): ExtraFormActions {
  if (extra === undefined) {
    return form
  }
  return {
    isDirty: () => form.isDirty() || extra.isDirty(),
    commit: async () => {
      await form.commit()
      await extra.commit()
    },
    discard: () => {
      form.discard()
      extra.discard()
    },
  }
}

export function FormActions(props: {
  form: ExtraFormActions
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
      'data-action': 'discard',
      disabled: !dirty,
      onClick: () => {
        props.form.discard()
        props.onDone()
      },
    }, t('card.discard', props.language)),
    h('button', {
      type: 'button',
      'data-action': 'commit',
      disabled: !dirty,
      onClick: () => {
        void props.form.commit().then(props.onDone, props.onDone)
      },
    }, t('card.save', props.language)),
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
    return h(SettingRow, { label: props.label },
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
    return h(SettingRow, { label: props.label },
      h('select', {
        className: 'dsh-friend-control',
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
    return h(SettingRow, { label: props.label, hint: String(field.value) },
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
    return h(SettingRow, { label: props.label },
      h('input', {
        className: 'dsh-friend-control',
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
    const hintKey = (field.hintKey ?? (props.section === 'asr' ? 'asr.openaiApiKeyHint' : 'tts.openaiApiKeyHint')) as I18nKey
    return h(SettingRow, { label: props.label, hint: t(hintKey, props.language) },
      h('input', {
        className: 'dsh-friend-control',
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
  return h(SettingRow, { label: props.label },
    h('input', {
      className: 'dsh-friend-control',
      type: 'text',
      'data-field': field.key,
      'data-control': field.kind,
      value: String(field.value ?? ''),
      ...(field.placeholder === undefined
        ? {}
        : { placeholder: t(field.placeholder as I18nKey, props.language) }),
      disabled: field.disabled === true,
      onChange: (event: { target: { value: string } }) => {
        props.onChange(event.target.value)
      },
    }),
  )
}

export function SettingRow(props: {
  label: string
  hint?: string
  children?: unknown
  tag?: 'label' | 'div'
}): unknown {
  const { createElement: h } = friendReact()
  return h(props.tag ?? 'label', { className: 'dsh-friend-row' },
    h('span', { className: 'dsh-friend-row-text' },
      h('span', { className: 'dsh-friend-row-title' }, props.label),
      props.hint === undefined ? null : h('span', { className: 'dsh-friend-row-desc' }, props.hint),
    ),
    props.children,
  )
}

function HotkeyControl(props: {
  field: SectionField
  label: string
  language: 'zh' | 'en'
  onChange: (value: unknown) => void
}): unknown {
  const { useState, useEffect, createElement: h } = friendReact()
  const [recording, setRecording] = useState(false)
  useEffect?.(() => {
    if (!recording) {
      return
    }
    const onKeyDown = (event: {
      key?: string
      code?: string
      altKey?: boolean
      ctrlKey?: boolean
      metaKey?: boolean
      shiftKey?: boolean
      preventDefault?(): void
      stopPropagation?(): void
    }): void => {
      event.preventDefault?.()
      if (event.key === 'Escape') {
        event.stopPropagation?.()
        setRecording(false)
        return
      }
      const spec = formatHotkeyFromEvent({
        key: event.key ?? '',
        ...(event.code !== undefined ? { code: event.code } : {}),
        ...(event.altKey === true ? { altKey: true } : {}),
        ...(event.ctrlKey === true ? { ctrlKey: true } : {}),
        ...(event.metaKey === true ? { metaKey: true } : {}),
        ...(event.shiftKey === true ? { shiftKey: true } : {}),
      })
      if (spec !== undefined) {
        event.stopPropagation?.()
        props.onChange(spec)
        setRecording(false)
      }
    }
    const target = globalThis as {
      addEventListener?: (type: string, listener: (event: { key?: string }) => void, options?: boolean) => void
      removeEventListener?: (type: string, listener: (event: { key?: string }) => void, options?: boolean) => void
    }
    target.addEventListener?.('keydown', onKeyDown, true)
    return () => target.removeEventListener?.('keydown', onKeyDown, true)
  }, [recording])
  return h(SettingRow, { label: props.label, tag: 'div' },
    h('div', { className: 'dsh-friend-hotkey' },
      h('input', {
        type: 'text',
        'data-field': props.field.key,
        'data-control': 'hotkey',
        value: recording ? t('asr.recordingHotkey', props.language) : String(props.field.value ?? ''),
        readOnly: recording,
        onChange: (event: { target: { value: string } }) => {
          if (!recording) {
            props.onChange(event.target.value)
          }
        },
      }),
      h('button', {
        type: 'button',
        'data-action': 'record-hotkey',
        'data-recording': recording ? 'true' : 'false',
        onClick: (event: { preventDefault(): void; stopPropagation(): void }) => {
          event.preventDefault()
          event.stopPropagation()
          setRecording((value) => !value)
        },
      }, t(recording ? 'asr.recordingHotkey' : 'asr.recordHotkey', props.language)),
    ),
  )
}
