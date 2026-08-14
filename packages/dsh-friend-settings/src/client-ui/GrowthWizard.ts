import { t } from '../i18n.ts'
import { FRIEND_GROWTH_PAGE_PATH } from '../paths.ts'
import { friendReact } from './friend-react.ts'
import { getJson, isRecord, postJson } from './http.ts'

type GrowthBeatRow = {
  id: string
  title: string
  kind: string
  age?: number
  included: boolean
}

type GrowthNodeDraft = {
  id: number
  title: string
  stageLabel: string
  ageFrom: string
  ageTo: string
  note: string
}

export function GrowthWizard(props: { language: 'zh' | 'en' }): unknown {
  const { useEffect, useState, createElement: h } = friendReact()
  const [status, setStatus] = useState(t('growth.idle', props.language))
  const [percent, setPercent] = useState(0)
  const [birthYear, setBirthYear] = useState('')
  const [currentAge, setCurrentAge] = useState('')
  const [worldSetting, setWorldSetting] = useState('')
  const [baseAttributes, setBaseAttributes] = useState('')
  const [model, setModel] = useState('')
  const [nodes, setNodes] = useState<GrowthNodeDraft[]>([])
  const [beats, setBeats] = useState<GrowthBeatRow[]>([])
  const [busy, setBusy] = useState(false)

  const applyDraft = (body: unknown): void => {
    if (!isRecord(body)) {
      return
    }
    if (isRecord(body.progress)) {
      if (typeof body.progress.percent === 'number') {
        setPercent(body.progress.percent)
      }
      const phase = typeof body.progress.phase === 'string' ? body.progress.phase : ''
      const message = typeof body.progress.message === 'string' ? body.progress.message : ''
      if (phase.length > 0 || message.length > 0) {
        setStatus(`${phase} ${message}`.trim())
      }
    }
    if (isRecord(body.profile)) {
      if (typeof body.profile.birthYear === 'number') {
        setBirthYear(String(body.profile.birthYear))
      }
      if (typeof body.profile.currentAge === 'number') {
        setCurrentAge(String(body.profile.currentAge))
      }
      if (typeof body.profile.worldSetting === 'string') {
        setWorldSetting(body.profile.worldSetting)
      }
      if (typeof body.profile.baseAttributes === 'string') {
        setBaseAttributes(body.profile.baseAttributes)
      }
    }
    if (isRecord(body.preferences) && typeof body.preferences.model === 'string') {
      setModel(body.preferences.model)
    }
    if (Array.isArray(body.beats)) {
      const rows: GrowthBeatRow[] = []
      for (const item of body.beats) {
        if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string') {
          continue
        }
        rows.push({
          id: item.id,
          title: item.title,
          kind: typeof item.kind === 'string' ? item.kind : 'episode',
          included: item.included !== false,
          ...(typeof item.age === 'number' ? { age: item.age } : {}),
        })
      }
      setBeats(rows)
    }
  }

  const reload = async (): Promise<void> => {
    applyDraft(await getJson('/friend/growth/draft'))
  }

  useEffect?.(() => {
    void reload()
    const Source = (globalThis as { EventSource?: new (url: string) => {
      addEventListener(type: string, listener: (event: { data: string }) => void): void
      close(): void
    } }).EventSource
    if (Source === undefined) {
      return
    }
    const events = new Source('/friend/growth/events')
    events.addEventListener('asset-progress', (event) => {
      try {
        const parsed: unknown = JSON.parse(event.data)
        applyDraft(isRecord(parsed) && parsed.payload !== undefined ? { progress: parsed.payload } : { progress: parsed })
      } catch {
        // ignore malformed SSE
      }
    })
    return () => events.close()
  }, [])

  const run = async (continueLife: boolean): Promise<void> => {
    setBusy(true)
    setStatus(t('growth.generating', props.language))
    const body = await postJson('/friend/growth/generate', {
      continue: continueLife,
      birthYear: birthYear.trim() === '' ? undefined : Number(birthYear),
      currentAge: currentAge.trim() === '' ? undefined : Number(currentAge),
      worldSetting,
      baseAttributes,
      model: model.trim() === '' ? undefined : model.trim(),
      nodes: nodes
        .filter((node) => node.title.trim().length > 0)
        .map((node) => ({
          id: node.id,
          title: node.title.trim(),
          stageLabel: node.stageLabel,
          note: node.note,
          ...(node.ageFrom.trim() === '' ? {} : { ageFrom: Number(node.ageFrom) }),
          ...(node.ageTo.trim() === '' ? {} : { ageTo: Number(node.ageTo) }),
        })),
    })
    setBusy(false)
    if (isRecord(body) && body.ok === false) {
      setStatus(typeof body.error === 'string' ? body.error : t('growth.generateFail', props.language))
      return
    }
    await reload()
  }

  const commit = async (): Promise<void> => {
    setBusy(true)
    const excludedIds = beats.filter((beat) => !beat.included).map((beat) => beat.id)
    const body = await postJson('/friend/growth/commit', { excludedIds })
    setBusy(false)
    if (isRecord(body) && body.ok === true) {
      const count = Array.isArray(body.committed) ? body.committed.length : 0
      setStatus(`${t('growth.committed', props.language)} ${count}`)
      await reload()
      return
    }
    setStatus(isRecord(body) && typeof body.error === 'string' ? body.error : t('growth.commitFail', props.language))
  }

  return h('div', { className: 'dsh-friend-growth', 'data-field': 'growthWizard' },
    h('p', { className: 'dsh-friend-muted' }, t('growth.intro', props.language)),
    h('section', { className: 'dsh-friend-step', 'data-growth-step': '1' },
      h('h3', { className: 'dsh-friend-step-title' }, t('growth.step1', props.language)),
      h('div', { className: 'dsh-friend-step-grid' },
        h(DraftField, {
          field: 'birthYear',
          label: t('growth.birthYear', props.language),
          value: birthYear,
          onChange: setBirthYear,
        }),
        h(DraftField, {
          field: 'currentAge',
          label: t('growth.currentAge', props.language),
          value: currentAge,
          onChange: setCurrentAge,
        }),
      ),
      h(DraftArea, {
        field: 'worldSetting',
        label: t('growth.worldSetting', props.language),
        value: worldSetting,
        onChange: setWorldSetting,
      }),
      h(DraftArea, {
        field: 'baseAttributes',
        label: t('growth.baseAttributes', props.language),
        value: baseAttributes,
        onChange: setBaseAttributes,
      }),
      h(DraftField, {
        field: 'growthModel',
        label: t('growth.model', props.language),
        value: model,
        onChange: setModel,
      }),
      ...nodes.map((node, index) => h('div', { key: node.id, className: 'dsh-friend-node' },
        h('input', {
          type: 'text',
          'data-field': `node-${node.id}-ageFrom`,
          placeholder: t('growth.ageFrom', props.language),
          value: node.ageFrom,
          onChange: (event: { target: { value: string } }) => {
            setNodes(patchNode(nodes, index, { ageFrom: event.target.value }))
          },
        }),
        h('input', {
          type: 'text',
          'data-field': `node-${node.id}-ageTo`,
          placeholder: t('growth.ageTo', props.language),
          value: node.ageTo,
          onChange: (event: { target: { value: string } }) => {
            setNodes(patchNode(nodes, index, { ageTo: event.target.value }))
          },
        }),
        h('input', {
          type: 'text',
          'data-field': `node-${node.id}-stage`,
          placeholder: t('growth.nodeStage', props.language),
          value: node.stageLabel,
          onChange: (event: { target: { value: string } }) => {
            setNodes(patchNode(nodes, index, { stageLabel: event.target.value }))
          },
        }),
        h('input', {
          type: 'text',
          'data-field': `node-${node.id}-title`,
          placeholder: t('growth.nodeTitle', props.language),
          value: node.title,
          onChange: (event: { target: { value: string } }) => {
            setNodes(patchNode(nodes, index, { title: event.target.value }))
          },
        }),
      )),
      h('div', { className: 'dsh-friend-actions' },
        h('button', {
          type: 'button',
          'data-action': 'add-node',
          onClick: () => {
            setNodes([...nodes, {
              id: (nodes.at(-1)?.id ?? 0) + 1,
              title: '',
              stageLabel: '',
              ageFrom: '',
              ageTo: '',
              note: '',
            }])
          },
        }, t('growth.addNode', props.language)),
      ),
    ),
    h('section', { className: 'dsh-friend-step', 'data-growth-step': '2' },
      h('h3', { className: 'dsh-friend-step-title' }, t('growth.step2', props.language)),
      h('p', { className: 'dsh-friend-muted', 'data-field': 'growthStatus' }, status),
      h('progress', { className: 'dsh-friend-progress', max: 100, value: percent, 'data-field': 'growthBar' }),
      h('div', { className: 'dsh-friend-actions' },
        h('button', {
          type: 'button',
          'data-action': 'generate',
          disabled: busy,
          onClick: () => {
            void run(false)
          },
        }, t('growth.generate', props.language)),
        h('button', {
          type: 'button',
          'data-action': 'continue',
          disabled: busy,
          onClick: () => {
            void run(true)
          },
        }, t('growth.continue', props.language)),
      ),
    ),
    h('section', { className: 'dsh-friend-step', 'data-growth-step': '3' },
      h('h3', { className: 'dsh-friend-step-title' }, t('growth.step3', props.language)),
      beats.length === 0
        ? h('p', { className: 'dsh-friend-muted' }, t('growth.noBeats', props.language))
        : beats.map((beat) => h('label', { key: beat.id, className: 'dsh-friend-beat' },
          h('input', {
            type: 'checkbox',
            'data-field': `beat-${beat.id}`,
            checked: beat.included,
            onChange: (event: { target: { checked: boolean } }) => {
              const next = beats.map((row) => row.id === beat.id ? { ...row, included: event.target.checked } : row)
              setBeats(next)
              void postJson('/friend/growth/exclude', {
                ids: next.filter((row) => !row.included).map((row) => row.id),
              })
            },
          }),
          h('span', null, `${beat.age === undefined ? '' : `（${beat.age}岁）`}${beat.title} · ${beat.kind}`),
        )),
      h('div', { className: 'dsh-friend-actions' },
        h('button', {
          type: 'button',
          'data-action': 'commit-growth',
          disabled: busy || beats.length === 0,
          onClick: () => {
            void commit()
          },
        }, t('growth.commit', props.language)),
      ),
    ),
    h('a', {
      href: FRIEND_GROWTH_PAGE_PATH,
      'data-field': 'growthPage',
      target: '_blank',
      rel: 'noreferrer',
      className: 'dsh-friend-muted',
    }, t('growth.openPage', props.language)),
  )
}

function DraftField(props: {
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

function DraftArea(props: {
  field: string
  label: string
  value: string
  onChange: (value: string) => void
}): unknown {
  const { createElement: h } = friendReact()
  return h('label', { className: 'dsh-friend-field' },
    h('span', null, props.label),
    h('textarea', {
      'data-field': props.field,
      'data-control': 'text',
      value: props.value,
      onChange: (event: { target: { value: string } }) => {
        props.onChange(event.target.value)
      },
    }),
  )
}

function patchNode(
  nodes: readonly GrowthNodeDraft[],
  index: number,
  patch: Partial<GrowthNodeDraft>,
): GrowthNodeDraft[] {
  return nodes.map((node, current) => current === index ? { ...node, ...patch } : node)
}
