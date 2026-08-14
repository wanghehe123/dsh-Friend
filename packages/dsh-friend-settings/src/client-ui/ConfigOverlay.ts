import { createAboutPayload, type AboutPayload } from '../about.ts'
import { resolveUiLanguage } from '../core-settings.ts'
import { FRIEND_GITHUB_RELEASES_PAGE } from '../github-repo.ts'
import { SECTION_FIELD_LABELS, SECTION_TITLE_KEYS, t } from '../i18n.ts'
import { createModelSectionForm, type ModelFieldWriter, type ModelInheritView } from '../model-form.ts'
import {
  DEFAULT_LEGACY_IMPORT_FROM,
  FRIEND_MEMORY_IMPORT_PATH,
  FRIEND_MEMORY_PAGE_PATH,
  FRIEND_REACTIONS_PAGE_PATH,
  FRIEND_SETTINGS_CHARACTERS_PATH,
  FRIEND_SETTINGS_EXPORT_PATH,
  FRIEND_SETTINGS_MODELS_PATH,
  FRIEND_SETTINGS_MODELS_TEST_PATH,
  FRIEND_SETTINGS_OPEN_DATA_DIR_PATH,
  FRIEND_SETTINGS_SHELL_PATH,
  FRIEND_SETTINGS_UPDATE_PATH,
  FRIEND_TTS_PREVIEW_PATH,
} from '../paths.ts'
import { readClientShellStatus, type ClientShellStatus } from '../shell-heartbeat.ts'
import type { FriendClientSettingsSnapshot } from '../project.ts'
import {
  CONFIG_CENTER_SECTIONS,
  createSectionLoader,
  type ConfigCenterSection,
  type OverlayController,
} from '../sections.ts'
import {
  createAsrSectionForm,
  createFloatSectionForm,
  createGrowthSectionForm,
  createMemorySectionForm,
  createPersonaSectionForm,
  createReactionsSectionForm,
  createStageSectionForm,
  createTtsSectionForm,
  type SettingsFieldWriter,
  type StagedSectionForm,
} from '../section-forms.ts'
import { FormActions, SectionFormView, type ExtraFormActions } from './fields.ts'
import { friendReact } from './friend-react.ts'
import { GrowthWizard } from './GrowthWizard.ts'
import { getJson, isRecord, postJson } from './http.ts'
import { PersonaCardEditor, type PersonaCardHandle } from './PersonaCardEditor.ts'
import { StageModelPanel } from './StageModelPanel.ts'

export type OverlayWriters = {
  persona?: SettingsFieldWriter
  tts?: SettingsFieldWriter
  asr?: SettingsFieldWriter
  stage?: SettingsFieldWriter
  memory?: SettingsFieldWriter
  growth?: SettingsFieldWriter
  reactions?: SettingsFieldWriter
  core?: SettingsFieldWriter
  model?: ModelFieldWriter
}

export type ConfigOverlayProps = {
  overlay: OverlayController
  snapshot: FriendClientSettingsSnapshot
  modelViews?: readonly ModelInheritView[]
  writers?: OverlayWriters
  characters?: readonly string[]
  shellConnected?: boolean
  onClose?: () => void
  systemLanguage?: string
}

export function ConfigOverlay(props: ConfigOverlayProps): unknown {
  const { createElement } = friendReact()
  const state = props.overlay.getState()
  if (!state.open) {
    return null
  }
  return createElement(ConfigOverlayOpen, { ...props, section: state.section })
}

function ConfigOverlayOpen(props: ConfigOverlayProps & { section: ConfigCenterSection }): unknown {
  const { useMemo, useState, useEffect, createElement: h } = friendReact()
  const [, bump] = useState(0)
  const section = props.overlay.getState().section
  const [shell, setShell] = useState<ClientShellStatus>({
    online: props.shellConnected === true,
    connected: props.shellConnected === true,
    downloadUrl: FRIEND_GITHUB_RELEASES_PAGE,
  })
  const [characters, setCharacters] = useState<readonly string[]>(props.characters ?? [])
  const [modelViews, setModelViews] = useState<readonly ModelInheritView[]>(props.modelViews ?? [])
  useEffect?.(() => {
    void getJson(FRIEND_SETTINGS_SHELL_PATH).then((body) => {
      if (body === undefined) {
        return
      }
      setShell(readClientShellStatus(body))
    })
    void getJson(FRIEND_SETTINGS_CHARACTERS_PATH).then((body) => {
      const slugs = readCharacterSlugs(body)
      if (slugs.length > 0) {
        setCharacters(slugs)
      }
    })
    void getJson(FRIEND_SETTINGS_MODELS_PATH).then((body) => {
      const views = readModelViews(body)
      if (views.length > 0) {
        setModelViews(views)
      }
    })
  }, [])
  const lang = resolveUiLanguage(props.snapshot.core.language, props.systemLanguage)
  const loader = useMemo(
    () => createSectionLoader({
      model: () => 'model',
      persona: () => 'persona',
      tts: () => 'tts',
      asr: () => 'asr',
      stage: () => 'stage',
      memory: () => 'memory',
      growth: () => 'growth',
      reactions: () => 'reactions',
      float: () => 'float',
      about: () => 'about',
    }),
    [],
  )
  const snapshotKey = JSON.stringify(props.snapshot)
  const baseForms = useMemo(
    () => createOverlayForms(props.snapshot, props.writers),
    [snapshotKey, props.writers],
  )
  const personaForm = useMemo(
    () => createOverlayForms(props.snapshot, props.writers, characters).persona,
    [snapshotKey, props.writers, characters],
  )
  const forms = { ...baseForms, persona: personaForm }
  const active = loader.load(section)
  const close = (): void => {
    props.overlay.close()
    props.onClose?.()
    bump((value) => value + 1)
  }
  useEffect?.(() => {
    const onKey = (event: { key?: string }): void => {
      if (event.key === 'Escape') {
        close()
      }
    }
    const target = globalThis as { addEventListener?: (type: string, listener: (event: { key?: string }) => void) => void; removeEventListener?: (type: string, listener: (event: { key?: string }) => void) => void }
    target.addEventListener?.('keydown', onKey)
    return () => target.removeEventListener?.('keydown', onKey)
  }, [])

  return h(
    'div',
    {
      className: 'dsh-friend-overlay',
      'data-testid': 'dsh-friend-config-overlay',
      'data-chrome': 'modal',
      role: 'presentation',
    },
    h('div', {
      className: 'dsh-friend-mask',
      'data-action': 'overlay-mask',
      'aria-hidden': 'true',
      onClick: close,
    }),
    h(
      'div',
      {
        className: 'dsh-friend-panel',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('overlay.title', lang),
      },
      h(
        'nav',
        { className: 'dsh-friend-nav', 'aria-label': t('overlay.title', lang) },
        h('div', { className: 'dsh-friend-nav-title' }, t('overlay.title', lang)),
        h('div', { className: 'dsh-friend-nav-list' },
          ...CONFIG_CENTER_SECTIONS.map((section) => h('button', {
            key: section,
            type: 'button',
            'data-active': section === props.overlay.getState().section ? 'true' : 'false',
            onClick: () => {
              props.overlay.setSection(section)
              bump((value) => value + 1)
            },
          }, t(SECTION_TITLE_KEYS[section], lang))),
        ),
      ),
      h('div', { className: 'dsh-friend-main' },
        h('header', null,
          h('button', {
            type: 'button',
            className: 'dsh-friend-close',
            'data-action': 'overlay-close',
            'aria-label': t('overlay.close', lang),
            onClick: close,
          }, '×'),
        ),
        h('div', { className: 'dsh-friend-pane', 'data-section': active },
          h(SectionBody, {
            section,
            snapshot: props.snapshot,
            forms,
            ...(modelViews.length > 0 ? { modelViews } : props.modelViews !== undefined ? { modelViews: props.modelViews } : {}),
            ...(props.writers?.model !== undefined ? { modelWriter: props.writers.model } : {}),
            shell: {
              online: props.shellConnected === true || shell.online,
              connected: props.shellConnected === true || shell.online,
              downloadUrl: shell.downloadUrl,
            },
            language: lang,
          }),
        ),
      ),
    ),
  )
}

export type OverlayForms = {
  persona: StagedSectionForm<Record<string, unknown>>
  tts: StagedSectionForm<Record<string, unknown>>
  asr: StagedSectionForm<Record<string, unknown>>
  stage: StagedSectionForm<Record<string, unknown>>
  memory: StagedSectionForm<Record<string, unknown>>
  growth: StagedSectionForm<Record<string, unknown>>
  reactions: StagedSectionForm<Record<string, unknown>>
  float: StagedSectionForm<Record<string, unknown>>
}

export function createOverlayForms(
  snapshot: FriendClientSettingsSnapshot,
  writers?: OverlayWriters,
  characters?: readonly string[],
): OverlayForms {
  return {
    persona: asRecordForm(createPersonaSectionForm(snapshot.persona, {
      ...(writers?.persona !== undefined ? { writer: writers.persona } : {}),
      ...(characters !== undefined ? { characters } : {}),
    })),
    tts: asRecordForm(bindWriter(createTtsSectionForm, snapshot.tts, writers?.tts)),
    asr: asRecordForm(bindWriter(createAsrSectionForm, snapshot.asr, writers?.asr)),
    stage: asRecordForm(bindWriter(createStageSectionForm, snapshot.stage, writers?.stage)),
    memory: asRecordForm(bindWriter(createMemorySectionForm, snapshot.memory, writers?.memory)),
    growth: asRecordForm(bindWriter(createGrowthSectionForm, snapshot.growth, writers?.growth)),
    reactions: asRecordForm(bindWriter(createReactionsSectionForm, snapshot.reactions, writers?.reactions)),
    float: asRecordForm(createFloatSectionForm(snapshot.core, snapshot.stage, {
      ...(writers?.core !== undefined ? { core: writers.core } : {}),
      ...(writers?.stage !== undefined ? { stage: writers.stage } : {}),
      ...(writers?.tts !== undefined ? { tts: writers.tts } : {}),
    }, snapshot.tts)),
  }
}

function bindWriter<S, T extends Record<string, unknown>>(
  create: (snapshot: S, writer?: SettingsFieldWriter) => StagedSectionForm<T>,
  snapshot: S,
  writer: SettingsFieldWriter | undefined,
): StagedSectionForm<T> {
  return writer === undefined ? create(snapshot) : create(snapshot, writer)
}

function asRecordForm<T extends Record<string, unknown>>(
  form: StagedSectionForm<T>,
): StagedSectionForm<Record<string, unknown>> {
  return form as unknown as StagedSectionForm<Record<string, unknown>>
}

function SectionBody(props: {
  section: ConfigCenterSection
  snapshot: FriendClientSettingsSnapshot
  forms: OverlayForms
  modelViews?: readonly ModelInheritView[]
  modelWriter?: ModelFieldWriter
  shell: ClientShellStatus
  language: 'zh' | 'en'
}): unknown {
  const { createElement: h } = friendReact()
  const { section, snapshot, language, forms } = props
  if (section === 'model') {
    return h(ModelPane, {
      snapshot,
      language,
      ...(props.modelViews !== undefined ? { modelViews: props.modelViews } : {}),
      ...(props.modelWriter !== undefined ? { writer: props.modelWriter } : {}),
    })
  }
  if (section === 'persona') {
    return h(PersonaPane, { form: forms.persona, language })
  }
  if (section === 'tts') {
    return h(SectionFormView, {
      title: t('section.tts', language),
      section: 'tts',
      form: forms.tts,
      labels: SECTION_FIELD_LABELS,
      language,
      extra: h('div', { className: 'dsh-friend-actions' },
        snapshot.tts.hasApiKey
          ? h('p', { className: 'dsh-friend-muted', 'data-field': 'hasApiKey' }, t('tts.hasApiKey', language))
          : null,
        h('button', {
          type: 'button',
          'data-action': 'tts-preview',
          onClick: () => {
            const draft = forms.tts.getDraft()
            void postJson(FRIEND_TTS_PREVIEW_PATH, {
              provider: draft.provider,
              voice: draft.voice,
              rate: draft.rate,
              pitch: draft.pitch,
            })
          },
        }, t('tts.preview', language)),
      ),
    })
  }
  if (section === 'asr') {
    return h(SectionFormView, {
      title: t('section.asr', language),
      section: 'asr',
      form: forms.asr,
      labels: SECTION_FIELD_LABELS,
      language,
      extra: String(forms.asr.getDraft().mode) === 'auto'
        ? h('p', { className: 'dsh-friend-muted', 'data-field': 'asrAutoHint' }, t('asr.autoHint', language))
        : null,
    })
  }
  if (section === 'stage') {
    return h(SectionFormView, {
      title: t('section.stage', language),
      section: 'stage',
      form: forms.stage,
      labels: SECTION_FIELD_LABELS,
      language,
      extra: h('div', null,
        h(StageModelPanel, { language }),
        h('p', {
          className: 'dsh-friend-muted',
          'data-field': 'perception',
          'data-control': 'status',
          'data-available': 'false',
        }, `${t('stage.perception', language)}: ${t('stage.perceptionHint', language)}`),
      ),
    })
  }
  if (section === 'memory') {
    return h(SectionFormView, {
      title: t('section.memory', language),
      section: 'memory',
      form: forms.memory,
      labels: SECTION_FIELD_LABELS,
      language,
      extra: h('a', {
        href: FRIEND_MEMORY_PAGE_PATH,
        'data-field': 'memoryPage',
        target: '_blank',
        rel: 'noreferrer',
      }, t('memory.openPage', language)),
    })
  }
  if (section === 'growth') {
    return h(SectionFormView, {
      title: t('section.growth', language),
      section: 'growth',
      form: forms.growth,
      labels: SECTION_FIELD_LABELS,
      language,
      extra: h(GrowthWizard, { language }),
    })
  }
  if (section === 'reactions') {
    return h(SectionFormView, {
      title: t('section.reactions', language),
      section: 'reactions',
      form: forms.reactions,
      labels: SECTION_FIELD_LABELS,
      language,
      extra: h('a', {
        href: FRIEND_REACTIONS_PAGE_PATH,
        'data-field': 'reactionsPage',
        target: '_blank',
        rel: 'noreferrer',
      }, t('reactions.openPage', language)),
    })
  }
  if (section === 'float') {
    return h(SectionFormView, {
      title: t('section.float', language),
      section: 'float',
      form: forms.float,
      labels: SECTION_FIELD_LABELS,
      language,
      extra: h('div', { 'data-field': 'shellPanel' },
        h('p', {
          className: 'dsh-friend-muted',
          'data-field': 'floatPopoutHint',
        }, t('float.popoutHint', language)),
        h('div', { className: 'dsh-friend-actions' },
          h('button', {
            type: 'button',
            'data-action': 'desktop-popout',
            onClick: () => {
              const target = globalThis as { dispatchEvent?: (event: Event) => boolean }
              const ctor = (globalThis as { CustomEvent?: new (name: string) => Event }).CustomEvent
              if (typeof ctor === 'function' && typeof target.dispatchEvent === 'function') {
                target.dispatchEvent(new ctor('dsh-friend:desktop-popout'))
              }
            },
          }, t('float.popout', language)),
        ),
        h('p', {
          'data-field': 'shellStatus',
        }, `${t('float.shellStatus', language)}: ${props.shell.online ? t('float.shellOnline', language) : t('float.shellOffline', language)}`),
        h('a', {
          href: props.shell.downloadUrl,
          'data-field': 'shellDownload',
          target: '_blank',
          rel: 'noreferrer',
        }, t('float.download', language)),
      ),
    })
  }
  const about = createAboutPayload()
  return h(AboutPane, { about, language })
}

function PersonaPane(props: {
  form: StagedSectionForm<Record<string, unknown>>
  language: 'zh' | 'en'
}): unknown {
  const { useState, createElement: h } = friendReact()
  const [card, setCard] = useState<PersonaCardHandle | undefined>(undefined)
  const slug = String(props.form.getDraft().currentSlug ?? 'default')
  const extraCommit: ExtraFormActions | undefined = card
  return h(SectionFormView, {
    title: t('section.persona', props.language),
    section: 'persona',
    form: props.form,
    labels: SECTION_FIELD_LABELS,
    language: props.language,
    extra: h(PersonaCardEditor, {
      language: props.language,
      slug,
      onBind: setCard,
    }),
    ...(extraCommit === undefined ? {} : { extraCommit }),
  })
}

function ModelPane(props: {
  snapshot: FriendClientSettingsSnapshot
  modelViews?: readonly ModelInheritView[]
  writer?: ModelFieldWriter
  language: 'zh' | 'en'
}): unknown {
  const { useMemo, useState, createElement: h } = friendReact()
  const [, bump] = useState(0)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testDetail, setTestDetail] = useState('')
  const form = useMemo(() => createModelSectionForm({
    chat: props.snapshot.persona.chatModel,
    summarize: props.snapshot.memory.summarizeModel,
    growth: props.snapshot.growth.model,
    ...(props.modelViews !== undefined ? { inheritViews: props.modelViews } : {}),
    ...(props.writer !== undefined ? { writer: props.writer } : {}),
    testConnection: async (purpose, override) => {
      const body = await postJson(FRIEND_SETTINGS_MODELS_TEST_PATH, { purpose, override })
      if (!isRecord(body)) {
        return { purpose, ok: false, detail: 'no response' }
      }
      const detail = typeof body.detail === 'string'
        ? body.detail
        : typeof body.error === 'string'
          ? body.error
          : ''
      return { purpose, ok: body.ok === true, detail }
    },
  }), [
    JSON.stringify(props.snapshot.persona.chatModel),
    JSON.stringify(props.snapshot.memory.summarizeModel),
    JSON.stringify(props.snapshot.growth.model),
    JSON.stringify(props.modelViews ?? []),
    props.writer,
  ])
  const views = form.inheritViews()
  const draft = form.getDraft()
  const redraw = (): void => bump((value) => value + 1)
  const testing = testStatus === 'testing'
  const statusLabel = testStatus === 'testing'
    ? t('model.testing', props.language)
    : testStatus === 'ok'
      ? testDetail.length > 0
        ? `${t('model.testOk', props.language)} · ${testDetail}`
        : t('model.testOk', props.language)
      : testStatus === 'fail'
        ? testDetail.length > 0
          ? `${t('model.testFail', props.language)} · ${testDetail}`
          : t('model.testFail', props.language)
        : ''
  return h('div', { 'data-section-form': 'model' },
    h('h2', { className: 'dsh-friend-pane-title' }, t('section.model', props.language)),
    h('p', { className: 'dsh-friend-muted' }, t('model.overrideHint', props.language)),
    views.length === 0
      ? h('p', null, t('model.inherit', props.language))
      : views.map((view) => h('p', { key: view.purpose },
        t(view.purpose === 'chat' ? 'model.chat' : view.purpose === 'summarize' ? 'model.summarize' : 'model.growth', props.language),
        ': ',
        `${view.inherited.provider}/${view.inherited.model}`,
      )),
    h(TextField, {
      field: 'chat',
      label: t('model.chat', props.language),
      value: draft.chat,
      onChange: (value: string) => {
        form.set('chat', value)
        redraw()
      },
    }),
    h(TextField, {
      field: 'summarize',
      label: t('model.summarize', props.language),
      value: draft.summarize,
      onChange: (value: string) => {
        form.set('summarize', value)
        redraw()
      },
    }),
    h(TextField, {
      field: 'growth',
      label: t('model.growth', props.language),
      value: draft.growth,
      onChange: (value: string) => {
        form.set('growth', value)
        redraw()
      },
    }),
    h('div', { className: 'dsh-friend-actions' },
      h('button', {
        type: 'button',
        'data-action': 'model-test',
        disabled: testing,
        onClick: () => {
          setTestStatus('testing')
          setTestDetail('')
          void form.test('chat').then((result) => {
            setTestStatus(result.ok ? 'ok' : 'fail')
            setTestDetail(result.detail)
          })
        },
      }, testing ? t('model.testing', props.language) : t('model.test', props.language)),
    ),
    testStatus === 'idle'
      ? null
      : h('p', {
        className: 'dsh-friend-test-status',
        'data-field': 'modelTestStatus',
        'data-ok': testStatus === 'ok' ? 'true' : testStatus === 'fail' ? 'false' : 'pending',
      }, statusLabel),
    h(FormActions, { form, language: props.language, onDone: redraw }),
  )
}

function TextField(props: {
  field: string
  label: string
  value: string
  onChange: (value: string) => void
}): unknown {
  const { createElement: h } = friendReact()
  return h('label', { className: 'dsh-friend-field' },
    h('span', null, props.label),
    h('input', {
      type: 'text',
      'data-field': props.field,
      'data-control': 'text',
      value: props.value,
      onChange: (event: { target: { value: string } }) => {
        props.onChange(event.target.value)
      },
    }),
  )
}

function AboutPane(props: { about: AboutPayload; language: 'zh' | 'en' }): unknown {
  const { useState, createElement: h } = friendReact()
  const [importFrom, setImportFrom] = useState<string>(DEFAULT_LEGACY_IMPORT_FROM)
  const [importStatus, setImportStatus] = useState('')
  return h('div', null,
    h('h2', null, t('section.about', props.language)),
    h('p', null, `${t('about.version', props.language)}: ${props.about.version}`),
    h('label', { className: 'dsh-friend-field' },
      h('span', null, t('about.importFrom', props.language)),
      h('input', {
        type: 'text',
        'data-field': 'importFrom',
        'data-control': 'text',
        value: importFrom,
        onChange: (event: { target: { value: string } }) => {
          setImportFrom(event.target.value)
        },
      }),
    ),
    h('div', { className: 'dsh-friend-actions' },
      h('button', {
        type: 'button',
        onClick: () => {
          void postJson(FRIEND_SETTINGS_OPEN_DATA_DIR_PATH)
        },
      }, t('about.openDataDir', props.language)),
      h('a', { href: FRIEND_SETTINGS_EXPORT_PATH }, t('about.export', props.language)),
      h('button', {
        type: 'button',
        'data-action': 'import-legacy',
        onClick: () => {
          setImportStatus(t('about.importing', props.language))
          void postJson(FRIEND_MEMORY_IMPORT_PATH, { from: importFrom }).then((body) => {
            setImportStatus(readImportStatus(body, props.language))
          })
        },
      }, t('about.importLegacy', props.language)),
      h('button', {
        type: 'button',
        onClick: () => {
          void getJson(FRIEND_SETTINGS_UPDATE_PATH)
        },
      }, t('about.update', props.language)),
    ),
    importStatus.length > 0
      ? h('p', { className: 'dsh-friend-muted', 'data-field': 'importStatus' }, importStatus)
      : null,
    h('h3', null, t('about.notices', props.language)),
    h('ul', null, ...props.about.notices.map((notice) => h('li', { key: notice.id }, `${notice.title} — ${notice.license}`))),
  )
}

function readCharacterSlugs(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.characters)) {
    return []
  }
  const slugs: string[] = []
  for (const item of body.characters) {
    if (typeof item === 'string' && item.trim().length > 0) {
      slugs.push(item.trim())
      continue
    }
    if (isRecord(item) && typeof item.slug === 'string' && item.slug.trim().length > 0) {
      slugs.push(item.slug.trim())
    }
  }
  return slugs
}

function readModelViews(body: unknown): ModelInheritView[] {
  if (!isRecord(body) || !Array.isArray(body.views)) {
    return []
  }
  const views: ModelInheritView[] = []
  for (const item of body.views) {
    const view = asModelInheritView(item)
    if (view !== undefined) {
      views.push(view)
    }
  }
  return views
}

function asModelInheritView(value: unknown): ModelInheritView | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  if (value.purpose !== 'chat' && value.purpose !== 'summarize' && value.purpose !== 'growth') {
    return undefined
  }
  if (!isRecord(value.inherited) || typeof value.inherited.provider !== 'string' || typeof value.inherited.model !== 'string') {
    return undefined
  }
  if (!isRecord(value.resolved) || typeof value.resolved.kind !== 'string' || typeof value.resolved.model !== 'string') {
    return undefined
  }
  const inherited = { provider: value.inherited.provider, model: value.inherited.model }
  const resolved: ModelInheritView['resolved'] = {
    kind: value.resolved.kind,
    model: value.resolved.model,
    ...(typeof value.resolved.provider === 'string' ? { provider: value.resolved.provider } : {}),
    ...(typeof value.resolved.baseURL === 'string' ? { baseURL: value.resolved.baseURL } : {}),
  }
  return {
    purpose: value.purpose,
    inherited,
    override: value.override,
    resolved,
  }
}

function readImportStatus(body: unknown, language: 'zh' | 'en'): string {
  if (isRecord(body) && body.ok === true) {
    return t('about.importOk', language)
  }
  return t('about.importFail', language)
}
