import { t } from '../i18n.ts'
import {
  FRIEND_STAGE_MODELS_DELETE_PATH,
  FRIEND_STAGE_MODELS_PATH,
  FRIEND_STAGE_MODELS_SELECT_PATH,
  FRIEND_STAGE_MODELS_UPLOAD_PATH,
} from '../paths.ts'
import { friendReact } from './friend-react.ts'
import { getJson, isRecord, postForm, postJson } from './http.ts'

type StageModel = {
  name: string
  kind: string
  label?: string
  modelUrl: string
}

export function StageModelPanel(props: { language: 'zh' | 'en' }): unknown {
  const { useEffect, useState, createElement: h } = friendReact()
  const [models, setModels] = useState<readonly StageModel[]>([])
  const [current, setCurrent] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = (): void => {
    void getJson(FRIEND_STAGE_MODELS_PATH).then((body) => {
      const next = readCatalog(body)
      setModels(next.models)
      setCurrent(next.current)
    })
  }

  useEffect?.(() => {
    refresh()
  }, [])

  return h('div', { 'data-field': 'stageModels' },
    h('p', { className: 'dsh-friend-muted' }, t('stage.modelsHint', props.language)),
    h('label', { className: 'dsh-friend-field' },
      h('span', null, t('stage.currentModel', props.language)),
      h('select', {
        className: 'dsh-friend-control',
        'data-field': 'currentModel',
        'data-control': 'select',
        value: current,
        disabled: busy || models.length === 0,
        onChange: (event: { target: { value: string } }) => {
          const name = event.target.value
          setCurrent(name)
          setBusy(true)
          void postJson(FRIEND_STAGE_MODELS_SELECT_PATH, { name }).then((body) => {
            setBusy(false)
            setStatus(isRecord(body) && body.ok === true
              ? t('stage.selectOk', props.language)
              : t('stage.selectFail', props.language))
            refresh()
          })
        },
      }, ...models.map((model) => h('option', {
        key: model.name,
        value: model.name,
      }, modelDisplayName(model)))),
    ),
    h('label', { className: 'dsh-friend-field' },
      h('span', null, t('stage.importLive2d', props.language)),
      h('input', {
        type: 'file',
        accept: '.zip,application/zip',
        'data-field': 'live2dZip',
        'data-control': 'file',
        disabled: busy,
        onChange: (event: { target: { files?: ArrayLike<File> | null } }) => {
          const file = event.target.files?.[0]
          if (file === undefined) {
            return
          }
          const form = new FormData()
          form.append('file', file)
          setBusy(true)
          setStatus(t('stage.importing', props.language))
          void postForm(FRIEND_STAGE_MODELS_UPLOAD_PATH, form).then((body) => {
            setBusy(false)
            setStatus(isRecord(body) && body.ok === true
              ? t('stage.importOk', props.language)
              : t('stage.importFail', props.language))
            refresh()
          })
        },
      }),
    ),
    current.length > 0 && models.find((model) => model.name === current)?.kind !== 'builtin'
      ? h('div', { className: 'dsh-friend-actions' },
        h('button', {
          type: 'button',
          'data-action': 'delete-live2d',
          disabled: busy,
          onClick: () => {
            setBusy(true)
            void postJson(FRIEND_STAGE_MODELS_DELETE_PATH, { name: current }).then((body) => {
              setBusy(false)
              setStatus(isRecord(body) && body.ok === true
                ? t('stage.deleteOk', props.language)
                : t('stage.deleteFail', props.language))
              refresh()
            })
          },
        }, t('stage.deleteModel', props.language)),
      )
      : null,
    status.length > 0
      ? h('p', { className: 'dsh-friend-muted', 'data-field': 'stageModelStatus' }, status)
      : null,
  )
}

function modelDisplayName(model: StageModel): string {
  if (typeof model.label === 'string' && model.label.length > 0) {
    return model.label
  }
  return model.kind === 'builtin' ? `${model.name} (builtin)` : model.name
}

function readCatalog(body: unknown): { current: string; models: StageModel[] } {
  if (!isRecord(body) || !Array.isArray(body.models)) {
    return { current: '', models: [] }
  }
  const models: StageModel[] = []
  for (const item of body.models) {
    if (!isRecord(item) || typeof item.name !== 'string' || typeof item.modelUrl !== 'string') {
      continue
    }
    models.push({
      name: item.name,
      kind: typeof item.kind === 'string' ? item.kind : 'user',
      ...(typeof item.label === 'string' && item.label.length > 0 ? { label: item.label } : {}),
      modelUrl: item.modelUrl,
    })
  }
  return {
    current: typeof body.current === 'string' ? body.current : models[0]?.name ?? '',
    models,
  }
}
