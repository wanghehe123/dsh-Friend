import { beforeAll, describe, expect, it } from 'vitest'

import { ConfigOverlay } from '../src/client-ui/ConfigOverlay.ts'
import { FRIEND_SETTINGS_CSS, FRIEND_SETTINGS_OVERLAY_Z_INDEX } from '../src/client-ui/styles.ts'
import { FRIEND_GITHUB_RELEASES_PAGE, FRIEND_GITHUB_REPO } from '../src/github-repo.ts'
import { projectDocuments } from '../src/project.ts'
import {
  CONFIG_CENTER_SECTIONS,
  createOverlayController,
  createSectionLoader,
  parseConfigHash,
  serializeConfigHash,
  type ConfigCenterSection,
} from '../src/sections.ts'
import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared/universal'
import {
  installFakeReact,
  mount,
  queryAll,
  queryByAction,
  queryByField,
  rerender,
  type VNode,
} from './fake-react.ts'

/**
 * Expected editable controls, kept in the test so deleting them from
 * ConfigOverlay / section-forms cannot silently keep this file green.
 */
const REQUIRED_CONTROLS: Record<Exclude<ConfigCenterSection, 'about'>, readonly string[]> = {
  model: ['chat', 'summarize', 'growth'],
  persona: ['currentSlug'],
  tts: ['provider', 'voice', 'rate', 'pitch', 'autoSpeak', 'stripStageDirections', 'volume', 'muted', 'openaiApiKey', 'openaiBaseURL', 'openaiModel', 'openaiFormat'],
  asr: ['engine', 'mode', 'hotkey', 'silenceMs', 'bargeIn', 'autoSend', 'language', 'openaiApiKey', 'openaiBaseURL', 'openaiModel'],
  stage: ['targetFps'],
  memory: ['enabled', 'autoSummaryEnabled', 'autoSummaryIdleMinutes', 'distillHour', 'distillMinute'],
  growth: ['enabled', 'language'],
  reactions: ['enabled', 'level', 'globalCooldownMs', 'kindCooldownMs', 'toolLongMs', 'quietHoursText', 'celebrateProbability'],
  float: ['floatEnabled', 'volume', 'muted', 'floatLeft', 'floatTop', 'floatWidth', 'floatHeight'],
}

const EDITABLE_CONTROLS = new Set(['text', 'number', 'range', 'toggle', 'select', 'hotkey', 'secret'])

function snapshot() {
  return projectDocuments({
    [FRIEND_SETTINGS_NAMESPACES.tts]: { provider: 'edge', voice: 'zh-CN-XiaoxiaoNeural', rate: 1 },
    [FRIEND_SETTINGS_NAMESPACES.asr]: { hotkey: 'Alt+S', mode: 'hold', engine: 'auto' },
    [FRIEND_SETTINGS_NAMESPACES.memory]: { distillHour: 4, distillMinute: 0 },
    [FRIEND_SETTINGS_NAMESPACES.reactions]: { level: 'action' },
    [FRIEND_SETTINGS_NAMESPACES.stage]: {
      targetFps: 30,
      floatLeft: 12,
      floatTop: 24,
      floatWidth: 280,
      floatHeight: 360,
    },
    [FRIEND_SETTINGS_NAMESPACES.persona]: { currentSlug: 'default' },
    [FRIEND_SETTINGS_NAMESPACES.growth]: { enabled: true, language: '中文' },
    [FRIEND_SETTINGS_NAMESPACES.core]: { floatEnabled: true, volume: 1, muted: false, language: 'zh' },
  })
}

function renderSection(section: ConfigCenterSection, options?: {
  writers?: { tts?: { set(field: string, value: unknown): Promise<void> } }
  shellConnected?: boolean
  characters?: readonly string[]
}): unknown {
  const overlay = createOverlayController({
    getHash: () => `#/friend/config/${section}`,
    setHash: () => {},
  })
  overlay.syncFromHash()
  return mount(() => ConfigOverlay({
    overlay,
    snapshot: snapshot(),
    ...(options?.writers !== undefined ? { writers: options.writers } : {}),
    ...(options?.shellConnected !== undefined ? { shellConnected: options.shellConnected } : {}),
    ...(options?.characters !== undefined ? { characters: options.characters } : {}),
  }))
}

function assertEditable(node: VNode | undefined, section: string, field: string): VNode {
  expect(node, `${section}.${field} is missing from ConfigOverlay`).toBeTruthy()
  const control = String(node?.props['data-control'] ?? '')
  expect(EDITABLE_CONTROLS.has(control), `${section}.${field} rendered as ${control || node?.type}`).toBe(true)
  expect(node?.type === 'input' || node?.type === 'select', `${section}.${field} is not an input/select`).toBe(true)
  return node as VNode
}

describe('config-center overlay shell', () => {
  it('parses and serializes a shareable hash', () => {
    expect(parseConfigHash('#/friend/config/tts')).toEqual({ open: true, section: 'tts' })
    expect(parseConfigHash('#/friend/config/memory')).toEqual({ open: true, section: 'memory' })
    expect(parseConfigHash('#/other')).toEqual({ open: false, section: 'model' })
    expect(serializeConfigHash('growth')).toBe('#/friend/config/growth')
  })

  it('opens, switches, and restores the previous hash on close', () => {
    let hash = '#/session/abc'
    const overlay = createOverlayController({
      getHash: () => hash,
      setHash: (next) => {
        hash = next
      },
    })

    overlay.open('asr')
    expect(overlay.getState()).toEqual({ open: true, section: 'asr' })
    expect(hash).toBe('#/friend/config/asr')

    overlay.setSection('stage')
    expect(hash).toBe('#/friend/config/stage')

    overlay.close()
    expect(overlay.getState().open).toBe(false)
    expect(hash).toBe('#/session/abc')
  })

  it('restores the hashed section after a refresh', () => {
    const overlay = createOverlayController({
      getHash: () => '#/friend/config/reactions',
      setHash: () => {},
    })
    expect(overlay.syncFromHash()).toEqual({ open: true, section: 'reactions' })
  })

  it('lazy-loads only the requested section', () => {
    const created: string[] = []
    const loader = createSectionLoader({
      model: () => {
        created.push('model')
        return 'model-pane'
      },
      persona: () => {
        created.push('persona')
        return 'persona-pane'
      },
      tts: () => {
        created.push('tts')
        return 'tts-pane'
      },
      asr: () => {
        created.push('asr')
        return 'asr-pane'
      },
      stage: () => {
        created.push('stage')
        return 'stage-pane'
      },
      memory: () => {
        created.push('memory')
        return 'memory-pane'
      },
      growth: () => {
        created.push('growth')
        return 'growth-pane'
      },
      reactions: () => {
        created.push('reactions')
        return 'reactions-pane'
      },
      float: () => {
        created.push('float')
        return 'float-pane'
      },
      about: () => {
        created.push('about')
        return 'about-pane'
      },
    })

    expect(loader.load('tts')).toBe('tts-pane')
    expect(loader.load('about')).toBe('about-pane')
    expect(created).toEqual(['tts', 'about'])
    expect(CONFIG_CENTER_SECTIONS).toHaveLength(10)
  })
})

describe('ConfigOverlay section controls', () => {
  beforeAll(() => {
    installFakeReact()
  })

  it('renders an editable control for every required field in the eight writable panes', () => {
    for (const [section, fields] of Object.entries(REQUIRED_CONTROLS)) {
      const tree = renderSection(section as ConfigCenterSection)
      for (const field of fields) {
        assertEditable(queryByField(tree, field), section, field)
      }
    }
  })

  it('stages a TTS voice change into the draft and writes it only on commit', async () => {
    const writes: Array<[string, unknown]> = []
    const tree = renderSection('tts', {
      writers: {
        tts: {
          async set(field, value) {
            writes.push([field, value])
          },
        },
      },
    })
    const voice = assertEditable(queryByField(tree, 'voice'), 'tts', 'voice')
    const onChange = voice.props.onChange as (event: { target: { value: string } }) => void
    onChange({ target: { value: 'zh-CN-YunxiNeural' } })
    const afterEdit = rerender()
    expect(queryByField(afterEdit, 'voice')?.props.value).toBe('zh-CN-YunxiNeural')
    expect(writes).toEqual([])

    const save = queryByAction(afterEdit, 'commit')
    expect(save, 'commit button missing').toBeTruthy()
    const click = save?.props.onClick as () => void
    click()
    await Promise.resolve()
    expect(writes).toContainEqual(['voice', 'zh-CN-YunxiNeural'])
  })

  it('switches OpenAI-compatible voice to a text field and format to a select', () => {
    const tree = renderSection('tts')
    const provider = assertEditable(queryByField(tree, 'provider'), 'tts', 'provider')
    const onChange = provider.props.onChange as (event: { target: { value: string } }) => void
    onChange({ target: { value: 'openai-compat' } })
    const after = rerender()
    const voice = assertEditable(queryByField(after, 'voice'), 'tts', 'voice')
    expect(voice.type).toBe('input')
    expect(voice.props['data-control']).toBe('text')
    const format = assertEditable(queryByField(after, 'openaiFormat'), 'tts', 'openaiFormat')
    expect(format.type).toBe('select')
    const optionValues = queryAll(format, (node) => node.type === 'option').map((node) => node.props.value)
    expect(optionValues).toEqual(expect.arrayContaining(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']))
  })

  it('keeps a dirty ASR draft when the characters list arrives', async () => {
    let releaseCharacters: (() => void) | undefined
    const previous = (globalThis as { fetch?: typeof fetch }).fetch
    ;(globalThis as { fetch: typeof fetch }).fetch = (async (url: string) => {
      if (String(url).includes('/friend/settings/characters')) {
        await new Promise<void>((resolve) => {
          releaseCharacters = resolve
        })
        return {
          headers: { get: () => 'application/json' },
          json: async () => ({ characters: [{ slug: 'alt', name: '备用' }] }),
        }
      }
      return {
        headers: { get: () => 'application/json' },
        json: async () => ({}),
      }
    }) as unknown as typeof fetch
    try {
      const tree = renderSection('asr')
      const onChange = queryByField(tree, 'hotkey')?.props.onChange as (
        event: { target: { value: string } },
      ) => void
      onChange({ target: { value: 'Alt+Q' } })
      expect(queryByField(rerender(), 'hotkey')?.props.value).toBe('Alt+Q')
      releaseCharacters?.()
      await Promise.resolve()
      await Promise.resolve()
      expect(queryByField(rerender(), 'hotkey')?.props.value).toBe('Alt+Q')
    } finally {
      if (previous === undefined) {
        delete (globalThis as { fetch?: typeof fetch }).fetch
      } else {
        ;(globalThis as { fetch: typeof fetch }).fetch = previous
      }
    }
  })

  it('discards a staged ASR hotkey before commit', () => {
    const tree = renderSection('asr')
    const hotkey = assertEditable(queryByField(tree, 'hotkey'), 'asr', 'hotkey')
    const onChange = hotkey.props.onChange as (event: { target: { value: string } }) => void
    onChange({ target: { value: 'Alt+Q' } })
    const dirty = rerender()
    expect(queryByField(dirty, 'hotkey')?.props.value).toBe('Alt+Q')
    const discard = queryByAction(dirty, 'discard')
    expect(discard, 'discard button missing').toBeTruthy()
    ;(discard?.props.onClick as () => void)()
    const after = rerender()
    expect(queryByField(after, 'hotkey')?.props.value).toBe('Alt+S')
  })

  it('shows shell download link and online status without making them editable', () => {
    const offline = renderSection('float')
    expect(queryByAction(offline, 'desktop-popout')?.type).toBe('button')
    const download = queryByField(offline, 'shellDownload')
    expect(download?.type).toBe('a')
    expect(download?.props.href).toBe(FRIEND_GITHUB_RELEASES_PAGE)
    expect(String(download?.props.href)).toContain(FRIEND_GITHUB_REPO)
    expect(queryByField(offline, 'shellStatus')?.children.join('')).toContain('壳未连接')

    const online = renderSection('float', { shellConnected: true })
    expect(queryByField(online, 'shellStatus')?.children.join('')).toContain('壳已连接')
    expect(queryByField(online, 'shellDownload')?.type).toBe('a')
  })

  it('shows a grayed perception placeholder on the stage pane with no switch', () => {
    const tree = renderSection('stage')
    const perception = queryByField(tree, 'perception')
    expect(perception, 'perception placeholder missing').toBeTruthy()
    expect(perception?.props['data-control']).toBe('status')
    expect(perception?.props['data-available']).toBe('false')
    expect(perception?.type).toBe('p')
    expect(String(perception?.children.join(''))).toContain('等待多模态模型可用')
    expect(queryByField(tree, 'perception')?.type).not.toBe('input')
  })

  it('renders a TTS preview button and keeps the API key field write-only', () => {
    const tree = renderSection('tts')
    const preview = queryByAction(tree, 'tts-preview')
    expect(preview, 'preview button missing').toBeTruthy()
    expect(preview?.type).toBe('button')
    const key = assertEditable(queryByField(tree, 'openaiApiKey'), 'tts', 'openaiApiKey')
    expect(key.props.type).toBe('password')
    expect(key.props.value).toBe('')
    expect(String(key.props.placeholder ?? '')).toContain('密钥')
  })

  it('POSTs a preview with the draft provider', async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = []
    const previous = (globalThis as { fetch?: typeof fetch }).fetch
    ;(globalThis as { fetch: typeof fetch }).fetch = (async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body })
      return {
        headers: { get: () => 'application/json' },
        json: async () => ({ kind: 'audio', providerId: 'edge', source: 'preview' }),
      }
    }) as unknown as typeof fetch
    try {
      const tree = renderSection('tts')
      const provider = assertEditable(queryByField(tree, 'provider'), 'tts', 'provider')
      ;(provider.props.onChange as (event: { target: { value: string } }) => void)({
        target: { value: 'openai-compat' },
      })
      const after = rerender()
      const preview = queryByAction(after, 'tts-preview')
      ;(preview?.props.onClick as () => void)()
      await Promise.resolve()
      expect(calls.some((call) => call.url === '/friend/tts/preview' && call.method === 'POST')).toBe(true)
      const previewCall = calls.find((call) => call.url === '/friend/tts/preview')
      expect(previewCall?.body).toContain('"provider":"openai-compat"')
    } finally {
      if (previous === undefined) {
        delete (globalThis as { fetch?: typeof fetch }).fetch
      } else {
        ;(globalThis as { fetch: typeof fetch }).fetch = previous
      }
    }
  })

  it('lists supplied characters as a persona select', () => {
    const tree = renderSection('persona', { characters: ['default', 'alt'] })
    const select = assertEditable(queryByField(tree, 'currentSlug'), 'persona', 'currentSlug')
    expect(select.type).toBe('select')
    expect(select.props['data-control']).toBe('select')
  })

  it('renders a persona select even for a single fetched character', () => {
    const tree = renderSection('persona', { characters: ['default'] })
    const select = assertEditable(queryByField(tree, 'currentSlug'), 'persona', 'currentSlug')
    expect(select.type).toBe('select')
  })

  it('POSTs legacy import with a from field instead of issuing GET', async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = []
    const previous = (globalThis as { fetch?: typeof fetch }).fetch
    ;(globalThis as { fetch: typeof fetch }).fetch = (async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body })
      return {
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: true }),
      }
    }) as unknown as typeof fetch
    try {
      const tree = renderSection('about')
      const from = queryByField(tree, 'importFrom')
      expect(from?.type).toBe('input')
      const button = queryByAction(tree, 'import-legacy')
      expect(button?.type).toBe('button')
      ;(button?.props.onClick as () => void)()
      await Promise.resolve()
      const imported = calls.find((call) => call.url === '/friend/memory/import')
      expect(imported?.method).toBe('POST')
      expect(imported?.body).toContain('"from"')
      expect(calls.some((call) => call.url === '/friend/memory/import' && call.method === 'GET')).toBe(false)
    } finally {
      if (previous === undefined) {
        delete (globalThis as { fetch?: typeof fetch }).fetch
      } else {
        ;(globalThis as { fetch: typeof fetch }).fetch = previous
      }
    }
  })

  it('exposes page links for memory, growth, and reactions', () => {
    expect(queryByField(renderSection('memory'), 'memoryPage')?.props.href).toBe('/friend/memory')
    expect(queryByField(renderSection('growth'), 'growthPage')?.props.href).toBe('/friend/growth')
    expect(queryByField(renderSection('reactions'), 'reactionsPage')?.props.href).toBe('/friend/reactions')
  })

  it('paints a centered modal, not a full-page sheet', () => {
    const tree = renderSection('growth')
    expect(FRIEND_SETTINGS_CSS).toContain('width: 800px')
    expect(FRIEND_SETTINGS_CSS).toContain('border-radius: 24px')
    expect(FRIEND_SETTINGS_CSS).toContain(`z-index: ${FRIEND_SETTINGS_OVERLAY_Z_INDEX}`)
    expect(FRIEND_SETTINGS_OVERLAY_Z_INDEX).toBeGreaterThan(2_147_483_000)
    expect(FRIEND_SETTINGS_CSS).toContain('--dsw-alias-bg-layer-2')
    expect(FRIEND_SETTINGS_CSS).not.toMatch(/\.dsh-friend-overlay\s*\{[^}]*inset:\s*0;[^}]*background:/)
    const overlay = queryAll(tree, (node) => node.props['data-testid'] === 'dsh-friend-config-overlay')[0]
    expect(overlay?.props['data-chrome']).toBe('modal')
    expect(overlay?.props.role).toBe('presentation')
    expect(queryByAction(tree, 'overlay-mask'), 'dimmed mask missing').toBeTruthy()
    expect(queryAll(tree, (node) => node.props.role === 'dialog')[0], 'dialog panel missing').toBeTruthy()
  })

  it('POSTs a model connection test and surfaces the host result', async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = []
    const previous = (globalThis as { fetch?: typeof fetch }).fetch
    ;(globalThis as { fetch: typeof fetch }).fetch = (async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body })
      return {
        headers: { get: () => 'application/json' },
        json: async () => (
          String(url).includes('/friend/settings/models/test')
            ? { ok: true, purpose: 'chat', detail: 'opencode-go/deepseek-v4-pro · pong' }
            : { views: [], characters: [], online: false }
        ),
      }
    }) as unknown as typeof fetch
    try {
      const tree = renderSection('model')
      const button = queryByAction(tree, 'model-test')
      expect(button, 'model-test button missing').toBeTruthy()
      expect(button?.type).toBe('button')
      expect(queryByField(tree, 'modelTestStatus')).toBeUndefined()
      ;(button?.props.onClick as () => void)()
      const pending = rerender()
      expect(queryByField(pending, 'modelTestStatus')?.children.join('')).toContain('测试中')
      expect(queryByAction(pending, 'model-test')?.props.disabled).toBe(true)
      for (let i = 0; i < 12; i += 1) {
        await Promise.resolve()
      }
      const done = rerender()
      const tested = calls.find((call) => call.url === '/friend/settings/models/test')
      expect(tested?.method).toBe('POST')
      expect(tested?.body).toContain('"purpose":"chat"')
      expect(queryByField(done, 'modelTestStatus')?.props['data-ok']).toBe('true')
      expect(queryByField(done, 'modelTestStatus')?.children.join('')).toContain('连接正常')
      expect(queryByField(done, 'modelTestStatus')?.children.join('')).toContain('pong')
    } finally {
      if (previous === undefined) {
        delete (globalThis as { fetch?: typeof fetch }).fetch
      } else {
        ;(globalThis as { fetch: typeof fetch }).fetch = previous
      }
    }
  })

  it('records an ASR hotkey from a captured document keydown', () => {
    type Listener = (event: {
      key?: string
      code?: string
      altKey?: boolean
      preventDefault(): void
      stopPropagation(): void
    }) => void
    const capture = new Set<Listener>()
    const previousAdd = (globalThis as { addEventListener?: typeof addEventListener }).addEventListener
    const previousRemove = (globalThis as { removeEventListener?: typeof removeEventListener }).removeEventListener
    ;(globalThis as { addEventListener: typeof addEventListener }).addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === 'keydown' && options === true) {
        capture.add(listener as Listener)
      }
    }) as typeof addEventListener
    ;(globalThis as { removeEventListener: typeof removeEventListener }).removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === 'keydown' && options === true) {
        capture.delete(listener as Listener)
      }
    }) as typeof removeEventListener
    try {
      const tree = renderSection('asr')
      const record = queryByAction(tree, 'record-hotkey')
      expect(record, 'record-hotkey button missing').toBeTruthy()
      ;(record?.props.onClick as (event: { preventDefault(): void; stopPropagation(): void }) => void)({
        preventDefault() {},
        stopPropagation() {},
      })
      const recording = rerender()
      expect(queryByAction(recording, 'record-hotkey')?.props['data-recording']).toBe('true')
      expect(String(queryByField(recording, 'hotkey')?.props.value ?? '')).toContain('请按下')
      expect(capture.size).toBeGreaterThan(0)
      for (const listener of capture) {
        listener({
          key: 'ß',
          code: 'KeyS',
          altKey: true,
          preventDefault() {},
          stopPropagation() {},
        })
      }
      const after = rerender()
      expect(queryByField(after, 'hotkey')?.props.value).toBe('Alt+S')
      expect(queryByAction(after, 'record-hotkey')?.props['data-recording']).toBe('false')
    } finally {
      if (previousAdd === undefined) {
        delete (globalThis as { addEventListener?: typeof addEventListener }).addEventListener
      } else {
        ;(globalThis as { addEventListener: typeof addEventListener }).addEventListener = previousAdd
      }
      if (previousRemove === undefined) {
        delete (globalThis as { removeEventListener?: typeof removeEventListener }).removeEventListener
      } else {
        ;(globalThis as { removeEventListener: typeof removeEventListener }).removeEventListener = previousRemove
      }
    }
  })

  it('loads the active persona card for editing', async () => {
    const previous = (globalThis as { fetch?: typeof fetch }).fetch
    ;(globalThis as { fetch: typeof fetch }).fetch = (async (url: string) => {
      const path = String(url)
      const body = path.includes('/friend/settings/persona')
        ? {
          ok: true,
          persona: {
            slug: 'default',
            name: '小友',
            nickname: '你',
            language: 'zh-CN',
            personality: '温柔',
            background: '默认伴侣',
            speakingStyle: '短句',
            greetings: ['你好，我在。'],
            tags: ['default'],
          },
        }
        : { views: [], characters: [], online: false }
      return {
        headers: { get: () => 'application/json' },
        json: async () => body,
      }
    }) as unknown as typeof fetch
    try {
      const tree = renderSection('persona', { characters: ['default'] })
      expect(queryByField(tree, 'personaCard'), 'persona card editor missing').toBeTruthy()
      expect(queryByAction(tree, 'save-persona-card'), 'persona card has its own save').toBeUndefined()
      expect(queryByAction(tree, 'commit')?.type).toBe('button')
      for (let i = 0; i < 8; i += 1) {
        await Promise.resolve()
      }
      const loaded = rerender()
      expect(queryByField(loaded, 'name')?.props.value).toBe('小友')
      expect(queryByField(loaded, 'personality')?.props.value).toBe('温柔')
      expect(queryByField(loaded, 'live2dModel'), 'Live2D belongs on the appearance pane').toBeUndefined()
    } finally {
      if (previous === undefined) {
        delete (globalThis as { fetch?: typeof fetch }).fetch
      } else {
        ;(globalThis as { fetch: typeof fetch }).fetch = previous
      }
    }
  })

  it('lists Live2D models and a zip import on the stage pane', async () => {
    const previous = (globalThis as { fetch?: typeof fetch }).fetch
    ;(globalThis as { fetch: typeof fetch }).fetch = (async (url: string) => {
      const path = String(url)
      const body = path === '/friend/models'
        ? {
          current: 'hiyori',
          models: [
            { name: 'hiyori', kind: 'builtin', label: 'Hiyori', modelUrl: '/friend/models/hiyori/model3.json' },
            { name: 'nailong', kind: 'builtin', label: '奶龙', modelUrl: '/friend/assets/vendor/nailong/naiwa-live2d-v3.model3.json' },
          ],
        }
        : { views: [], characters: [], online: false }
      return {
        headers: { get: () => 'application/json' },
        json: async () => body,
      }
    }) as unknown as typeof fetch
    try {
      const tree = renderSection('stage')
      expect(queryByField(tree, 'stageModels'), 'stage model panel missing').toBeTruthy()
      expect(queryByField(tree, 'live2dZip')?.props.type).toBe('file')
      for (let i = 0; i < 8; i += 1) {
        await Promise.resolve()
      }
      const loaded = rerender()
      expect(queryByField(loaded, 'currentModel')?.type).toBe('select')
      expect(queryByField(loaded, 'currentModel')?.props.value).toBe('hiyori')
      const optionLabels = queryAll(loaded, (node) => node.type === 'option').map((node) => node.children?.[0] ?? node.props.children)
      expect(optionLabels).toEqual(expect.arrayContaining(['Hiyori', '奶龙']))
      expect(queryByField(loaded, 'perception')?.props['data-available']).toBe('false')
    } finally {
      if (previous === undefined) {
        delete (globalThis as { fetch?: typeof fetch }).fetch
      } else {
        ;(globalThis as { fetch: typeof fetch }).fetch = previous
      }
    }
  })

  it('embeds the three-step growth wizard inside the overlay', () => {
    const tree = renderSection('growth')
    expect(queryByField(tree, 'growthWizard'), 'growth wizard missing').toBeTruthy()
    expect(queryAll(tree, (node) => node.props['data-growth-step'] === '1')).toHaveLength(1)
    expect(queryAll(tree, (node) => node.props['data-growth-step'] === '2')).toHaveLength(1)
    expect(queryAll(tree, (node) => node.props['data-growth-step'] === '3')).toHaveLength(1)
    expect(queryByAction(tree, 'generate')?.type).toBe('button')
    expect(queryByAction(tree, 'continue')?.type).toBe('button')
    expect(queryByAction(tree, 'commit-growth')?.type).toBe('button')
    expect(queryByField(tree, 'birthYear')?.props['data-control']).toBe('text')
    expect(queryByField(tree, 'worldSetting')?.type).toBe('textarea')
  })
})
