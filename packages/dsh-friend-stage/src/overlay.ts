import { FRIEND_SETTINGS_NAMESPACES, type FriendSettingsNamespace } from '@wish233/dsh-friend-shared/universal'

import { createBubbleController, handleBubbleKeydown } from './bubble.ts'
import { CORE_SETTINGS_NAMESPACE, readCoreStageVisible } from './core-gate.ts'
import {
  applyCornerResize,
  applyLiveMute,
  applyPointerDrag,
  chooseAvoidingCorner,
  detectDshPet,
  FLOAT_Z_INDEX,
  FRIEND_MUTE_EVENT,
  FRIEND_PLAYBACK_GLOBAL,
  FRIEND_UNMUTE_EVENT,
  persistFloatHidden,
  persistFloatMuted,
  persistFloatRect,
  rectFromSettings,
  type FloatPersist,
  type FloatPoint,
  type FloatRect,
  type ResizeHandle,
} from './float-stage.ts'
import { readStageUiSettings } from './live2d/stage-settings.ts'
import {
  canRequestDesktopPopout,
  requestDesktopPopout,
  FRIEND_ASR_RESUME_EVENT,
  FRIEND_ASR_YIELD_EVENT,
  FRIEND_DESKTOP_POPOUT_EVENT,
  PET_IFRAME_ALLOW,
  type DesktopPopoutHost,
} from './desktop-popout.ts'
import {
  ensureFriendOverlayStyles,
  isOverlayStyleDocument,
  releaseFriendOverlayStyles,
} from './overlay-styles.ts'

export const STAGE_SETTINGS_NAMESPACE = FRIEND_SETTINGS_NAMESPACES.stage
export const PET_EMBED_SRC = '/friend/pet?transparent=1&embed=1'
export const CHAT_PATH = '/friend/stage/chat'

export type OverlaySettingsScope = {
  getSnapshot(): { value: unknown }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
}

export type OverlaySettingsBinder = {
  bind(spec: { namespace: FriendSettingsNamespace }): OverlaySettingsScope
}

export type OverlayPointerTarget = {
  dataset?: Record<string, string>
  setPointerCapture?(pointerId: number): void
  releasePointerCapture?(pointerId: number): void
}

export type OverlayDocument = {
  body: { appendChild(node: OverlayElement): void }
  createElement(tag: string): OverlayElement
  querySelector(selector: string): unknown
  addEventListener(type: string, listener: (event: OverlayPointerEvent) => void): void
  removeEventListener(type: string, listener: (event: OverlayPointerEvent) => void): void
}

export type OverlayElement = {
  id: string
  className: string
  hidden: boolean
  style: { cssText: string }
  textContent: string | null
  innerHTML: string
  dataset: Record<string, string>
  appendChild(node: OverlayElement): void
  addEventListener(type: string, listener: (event: OverlayPointerEvent) => void): void
  removeEventListener(type: string, listener: (event: OverlayPointerEvent) => void): void
  setAttribute(name: string, value: string): void
  getAttribute?(name: string): string | null
  querySelector(selector: string): OverlayElement | null
  getBoundingClientRect?(): { left: number; top: number; width: number; height: number }
  setPointerCapture?(pointerId: number): void
  releasePointerCapture?(pointerId: number): void
}

export type OverlayPointerEvent = {
  button?: number
  clientX: number
  clientY: number
  pointerId?: number
  key?: string
  shiftKey?: boolean
  preventDefault(): void
  stopPropagation(): void
  currentTarget?: OverlayPointerTarget
  target?: { value?: string }
}

export type OverlayWindow = DesktopPopoutHost & {
  innerWidth: number
  innerHeight: number
  location: { assign(url: string): void }
  dispatchEvent(event: { type: string }): boolean
  addEventListener?(type: string, listener: (event: { type: string }) => void): void
  removeEventListener?(type: string, listener: (event: { type: string }) => void): void
}

export type OverlayFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>

export type OverlayHandle = {
  show(): void
  hide(): void
  dispose(): void
}

export type MountOverlayOptions = Readonly<{
  document: OverlayDocument
  window: OverlayWindow
  settings?: OverlaySettingsScope
  coreSettings?: OverlaySettingsScope
  playbackSettings?: OverlaySettingsScope
  fetch?: OverlayFetch
  send?: (text: string) => Promise<void>
}>

type DragKind = 'move' | ResizeHandle

/**
 * Mount the in-page float chrome. The Live2D renderer stays inside an iframe
 * pointed at `/friend/pet` so pixi never enters the dsh client factory.
 */
export function mountFriendStageOverlay(options: MountOverlayOptions): OverlayHandle {
  const doc = options.document
  const win = options.window
  const store = createPersist(options.settings)
  const settings = readStageUiSettings(options.settings?.getSnapshot().value)
  const petPresent = detectDshPet(doc)
  const corner = chooseAvoidingCorner(petPresent)
  let rect = rectFromSettings(settings, { width: win.innerWidth, height: win.innerHeight }, corner)
  let hidden = settings.floatHidden
  let poppedOut = false
  let muted = readInitialMuted(settings, options.coreSettings, options.playbackSettings)
  let coreEnabled = readCoreStageVisible(options.coreSettings?.getSnapshot().value)
  let menuOpen = false
  let drag: { kind: DragKind; from: FloatPoint; start: FloatRect } | undefined
  let capture: { target: OverlayPointerTarget; pointerId: number } | undefined

  if (isOverlayStyleDocument(doc)) {
    ensureFriendOverlayStyles(doc)
  }

  const host = doc.createElement('div')
  host.id = 'dsh-friend-float'
  host.dataset.friendFloat = '1'
  host.dataset.avoidedPet = petPresent ? '1' : '0'
  applyHostStyle(host, rect, !coreEnabled || hidden)

  const chrome = doc.createElement('div')
  chrome.className = 'dsh-friend-float-chrome'
  chrome.innerHTML = renderChromeHtml(muted)
  host.appendChild(chrome)
  doc.body.appendChild(host)

  const bubble = createBubbleController({
    timeoutMs: settings.bubbleTimeoutMs,
    send: options.send ?? ((text) => postChat(options.fetch ?? globalFetch, text)),
  })

  const renderBubble = (): void => {
    const node = host.querySelector('[data-friend-bubble]')
    if (node === null) return
    const view = bubble.getState()
    node.hidden = !view.open
    const text = host.querySelector('[data-friend-bubble-text]')
    if (text) text.textContent = view.assistantText
    const typing = host.querySelector('[data-friend-typing]')
    if (typing) typing.hidden = !view.typing
    const error = host.querySelector('[data-friend-bubble-error]')
    if (error) error.textContent = view.error
  }
  const unsubBubble = bubble.subscribe(renderBubble)
  renderBubble()

  const persistRect = (): void => {
    void persistFloatRect(store, rect)
  }

  const syncIframe = (): void => {
    const iframe = host.querySelector('iframe')
    if (iframe === null) return
    const src = coreEnabled ? PET_EMBED_SRC : 'about:blank'
    if (iframe.getAttribute?.('src') !== src) iframe.setAttribute('src', src)
  }

  const applyChrome = (): void => {
    applyHostStyle(host, rect, !coreEnabled || hidden || poppedOut)
    syncIframe()
  }

  const openDesktopPopout = (): void => {
    if (poppedOut || !canRequestDesktopPopout(win)) {
      return
    }
    void requestDesktopPopout(win, { width: rect.width, height: rect.height }).then((result) => {
      if (result === undefined) {
        return
      }
      poppedOut = true
      applyChrome()
      dispatchFriendWindowEvent(win, FRIEND_ASR_YIELD_EVENT)
      void result.closed.then(() => {
        poppedOut = false
        applyChrome()
        dispatchFriendWindowEvent(win, FRIEND_ASR_RESUME_EVENT)
      })
    })
  }

  const applyStageSnapshot = (): void => {
    if (options.settings === undefined) return
    const next = readStageUiSettings(options.settings.getSnapshot().value)
    if (drag === undefined) {
      rect = rectFromSettings(next, { width: win.innerWidth, height: win.innerHeight }, corner)
    }
    hidden = next.floatHidden
    muted = options.playbackSettings !== undefined
      ? readPlaybackMuted(options.playbackSettings.getSnapshot().value, next.floatMuted)
      : next.floatMuted
    syncMuteLabel()
    applyChrome()
  }

  const applyCoreSnapshot = (): void => {
    coreEnabled = readCoreStageVisible(options.coreSettings?.getSnapshot().value)
    applyChrome()
  }

  const releaseCapturedPointer = (): void => {
    if (capture === undefined) return
    const held = capture
    capture = undefined
    if (typeof held.target.releasePointerCapture !== 'function') return
    try {
      held.target.releasePointerCapture(held.pointerId)
    } catch {
      // Pointer already released or the element left the tree.
    }
  }

  const capturePointer = (event: OverlayPointerEvent): void => {
    const pointerId = event.pointerId
    const target = event.currentTarget
    if (typeof pointerId !== 'number' || target === undefined) return
    if (typeof target.setPointerCapture !== 'function') return
    try {
      target.setPointerCapture(pointerId)
      capture = { target, pointerId }
    } catch {
      capture = undefined
    }
  }

  const onPointerMove = (event: OverlayPointerEvent): void => {
    if (drag === undefined) return
    const to = { x: event.clientX, y: event.clientY }
    const viewport = { width: win.innerWidth, height: win.innerHeight }
    rect = drag.kind === 'move'
      ? applyPointerDrag(drag.start, drag.from, to, viewport)
      : applyCornerResize(drag.start, drag.kind, drag.from, to, viewport)
    applyChrome()
  }

  const onPointerUp = (): void => {
    if (drag === undefined) return
    drag = undefined
    chrome.dataset.dragging = 'false'
    releaseCapturedPointer()
    persistRect()
  }

  const startDrag = (kind: DragKind, event: OverlayPointerEvent): void => {
    event.preventDefault()
    drag = { kind, from: { x: event.clientX, y: event.clientY }, start: rect }
    chrome.dataset.dragging = 'true'
    capturePointer(event)
  }

  chrome.querySelector('[data-friend-drag]')?.addEventListener('pointerdown', (event) => {
    if (event.button === 2) return
    startDrag('move', event)
  })

  chrome.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    menuOpen = !menuOpen
    chrome.dataset.menu = menuOpen ? 'true' : 'false'
    const menu = host.querySelector('[data-friend-menu]')
    if (menu) menu.hidden = !menuOpen
  })

  const syncMuteLabel = (): void => {
    const button = host.querySelector('[data-action="mute"]')
    if (button) button.textContent = muted ? '取消静音' : '静音'
  }

  bindMenu(host, {
    onMute: () => {
      const next = !muted
      muted = next
      syncMuteLabel()
      applyLiveMute(next)
      const playback = readPlaybackApi()
      if (playback !== undefined) {
        void playback.setMuted(next)
      }
      dispatchFriendWindowEvent(win, next ? FRIEND_MUTE_EVENT : FRIEND_UNMUTE_EVENT)
      void persistFloatMuted(store, next, options.playbackSettings)
    },
    onHide: () => {
      hidden = true
      applyChrome()
      void persistFloatHidden(store, true)
    },
    onListen: () => {
      dispatchFriendWindowEvent(win, 'dsh-friend:toggle-listen')
    },
    onPopout: () => {
      openDesktopPopout()
    },
    onSettings: () => {
      dispatchFriendWindowEvent(win, 'dsh-friend:open-settings')
      win.location.assign('#/friend/config/model')
    },
  })

  bindResizeHandles(chrome, startDrag)

  const input = host.querySelector('[data-friend-input]')
  input?.addEventListener('keydown', (event) => {
    handleBubbleKeydown({
      key: event.key ?? '',
      shiftKey: event.shiftKey === true,
      preventDefault: () => event.preventDefault(),
    }, bubble)
  })
  input?.addEventListener('input', (event) => {
    const value = event.target?.value
    if (typeof value === 'string') bubble.setInput(value)
  })

  doc.addEventListener('pointermove', onPointerMove)
  doc.addEventListener('pointerup', onPointerUp)
  doc.addEventListener('pointercancel', onPointerUp)
  applyChrome()

  const applyPlaybackSnapshot = (): void => {
    if (options.playbackSettings === undefined) return
    muted = readPlaybackMuted(options.playbackSettings.getSnapshot().value, muted)
    syncMuteLabel()
  }

  const onExternalMute = (event: { type: string }): void => {
    muted = event.type === FRIEND_MUTE_EVENT
    syncMuteLabel()
    applyLiveMute(muted)
  }

  const unsubStage = options.settings?.subscribe(applyStageSnapshot)
  const unsubCore = options.coreSettings?.subscribe(applyCoreSnapshot)
  const unsubPlayback = options.playbackSettings?.subscribe(applyPlaybackSnapshot)
  const onDesktopPopout = (): void => {
    openDesktopPopout()
  }
  win.addEventListener?.(FRIEND_MUTE_EVENT, onExternalMute)
  win.addEventListener?.(FRIEND_UNMUTE_EVENT, onExternalMute)
  win.addEventListener?.(FRIEND_DESKTOP_POPOUT_EVENT, onDesktopPopout)
  hydrateMutedFromSnapshot(options.fetch ?? globalFetch, (next) => {
    muted = next
    syncMuteLabel()
  })

  let poll: ReturnType<typeof setInterval> | undefined
  const fetchImpl = options.fetch ?? globalFetch
  poll = setInterval(() => {
    if (!coreEnabled) return
    bubble.tick(Date.now())
    void fetchImpl(CHAT_PATH).then(async (response) => {
      if (!response.ok) return
      const body = await response.json()
      if (isChatBody(body)) bubble.applyChatSnapshot(body)
    }).catch(() => undefined)
  }, 400)

  return {
    show() {
      hidden = false
      applyChrome()
      void persistFloatHidden(store, false)
    },
    hide() {
      hidden = true
      applyChrome()
      void persistFloatHidden(store, true)
    },
    dispose() {
      unsubBubble()
      unsubStage?.()
      unsubCore?.()
      unsubPlayback?.()
      win.removeEventListener?.(FRIEND_MUTE_EVENT, onExternalMute)
      win.removeEventListener?.(FRIEND_UNMUTE_EVENT, onExternalMute)
      win.removeEventListener?.(FRIEND_DESKTOP_POPOUT_EVENT, onDesktopPopout)
      if (poll !== undefined) clearInterval(poll)
      releaseCapturedPointer()
      doc.removeEventListener('pointermove', onPointerMove)
      doc.removeEventListener('pointerup', onPointerUp)
      doc.removeEventListener('pointercancel', onPointerUp)
      host.hidden = true
      if (isOverlayStyleDocument(doc)) {
        releaseFriendOverlayStyles(doc)
      }
    },
  }
}

export function bindOverlaySettings(binder: OverlaySettingsBinder): OverlaySettingsScope {
  return binder.bind({ namespace: STAGE_SETTINGS_NAMESPACE })
}

export function bindCoreSettings(binder: OverlaySettingsBinder): OverlaySettingsScope {
  return binder.bind({ namespace: CORE_SETTINGS_NAMESPACE })
}

export function bindPlaybackSettings(binder: OverlaySettingsBinder): OverlaySettingsScope {
  return binder.bind({ namespace: FRIEND_SETTINGS_NAMESPACES.tts })
}

function createPersist(settings: OverlaySettingsScope | undefined): FloatPersist {
  if (settings !== undefined) {
    return {
      get: () => readStageUiSettings(settings.getSnapshot().value),
      set: (field, value) => settings.set(field, value),
    }
  }
  const memory: Record<string, unknown> = {}
  return {
    get: () => readStageUiSettings(memory),
    set: async (field, value) => {
      memory[field] = value
    },
  }
}

function applyHostStyle(host: OverlayElement, rect: FloatRect, hidden: boolean): void {
  host.hidden = hidden
  host.style.cssText = [
    'position:fixed',
    `left:${rect.left}px`,
    `top:${rect.top}px`,
    `width:${rect.width}px`,
    `height:${rect.height}px`,
    `z-index:${FLOAT_Z_INDEX}`,
    'pointer-events:auto',
  ].join(';')
}

function renderChromeHtml(muted: boolean): string {
  return `
    <div data-friend-drag class="dsh-friend-float-drag"></div>
    <button type="button" data-resize="top-left" aria-label="resize top left"></button>
    <button type="button" data-resize="top-right" aria-label="resize top right"></button>
    <button type="button" data-resize="bottom-left" aria-label="resize bottom left"></button>
    <button type="button" data-resize="bottom-right" aria-label="resize bottom right"></button>
    <iframe title="dsh-Friend stage" src="${PET_EMBED_SRC}" allow="${PET_IFRAME_ALLOW}" sandbox="allow-scripts allow-same-origin"></iframe>
    <div data-friend-bubble hidden>
      <p data-friend-typing hidden>…</p>
      <p data-friend-bubble-text></p>
      <p data-friend-bubble-error></p>
      <input data-friend-input type="text" enterkeyhint="send" aria-label="快捷聊天">
    </div>
    <menu data-friend-menu hidden>
      <button type="button" data-action="mute">${muted ? '取消静音' : '静音'}</button>
      <button type="button" data-action="hide">隐藏</button>
      <button type="button" data-action="listen">切换监听</button>
      <button type="button" data-action="popout">弹出到桌面</button>
      <button type="button" data-action="settings">打开配置中心</button>
    </menu>
  `
}

function bindResizeHandles(
  chrome: OverlayElement,
  startDrag: (kind: DragKind, event: OverlayPointerEvent) => void,
): void {
  for (const handle of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
    const node = chrome.querySelector(`[data-resize="${handle}"]`)
    node?.addEventListener('pointerdown', (event) => startDrag(handle, event))
  }
}

function bindMenu(host: OverlayElement, actions: {
  onMute: () => void
  onHide: () => void
  onListen: () => void
  onPopout: () => void
  onSettings: () => void
}): void {
  const mapping: Record<string, () => void> = {
    mute: actions.onMute,
    hide: actions.onHide,
    listen: actions.onListen,
    popout: actions.onPopout,
    settings: actions.onSettings,
  }
  for (const [action, run] of Object.entries(mapping)) {
    host.querySelector(`[data-action="${action}"]`)?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      run()
    })
  }
}

async function postChat(fetchImpl: OverlayFetch, text: string): Promise<void> {
  const response = await fetchImpl(CHAT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'send failed' }))
    const error = isRecord(body) && typeof body.error === 'string' ? body.error : 'send failed'
    throw new Error(error)
  }
}

function globalFetch(
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ ok: boolean; json(): Promise<unknown> }> {
  return fetch(input, init)
}

function isChatBody(value: unknown): value is {
  assistantText: string
  typing: boolean
  error: string
  status: 'idle' | 'sending' | 'typing' | 'ready' | 'error'
} {
  if (!isRecord(value)) return false
  return typeof value.assistantText === 'string'
    && typeof value.typing === 'boolean'
    && typeof value.error === 'string'
    && typeof value.status === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readInitialMuted(
  stage: ReturnType<typeof readStageUiSettings>,
  coreSettings: OverlaySettingsScope | undefined,
  playbackSettings: OverlaySettingsScope | undefined,
): boolean {
  if (playbackSettings !== undefined) {
    return readPlaybackMuted(playbackSettings.getSnapshot().value, stage.floatMuted)
  }
  const core = coreSettings?.getSnapshot().value
  if (isRecord(core) && typeof core.muted === 'boolean') {
    return core.muted
  }
  return stage.floatMuted
}

function readPlaybackMuted(value: unknown, fallback: boolean): boolean {
  if (isRecord(value) && typeof value.muted === 'boolean') {
    return value.muted
  }
  return fallback
}

function readPlaybackApi(): { setMuted(muted: boolean): void | Promise<void> } | undefined {
  const api = (globalThis as Record<string, unknown>)[FRIEND_PLAYBACK_GLOBAL]
  if (isRecord(api) && typeof api.setMuted === 'function') {
    return api as { setMuted(muted: boolean): void | Promise<void> }
  }
  return undefined
}

function dispatchFriendWindowEvent(win: OverlayWindow, type: string): void {
  const ctor = (globalThis as { CustomEvent?: new (name: string) => { type: string } }).CustomEvent
  if (typeof ctor === 'function') {
    try {
      win.dispatchEvent(new ctor(type))
      return
    } catch {
      // fake windows accept a plain { type }
    }
  }
  win.dispatchEvent({ type })
}

function hydrateMutedFromSnapshot(
  fetchImpl: OverlayFetch,
  apply: (muted: boolean) => void,
): void {
  void fetchImpl('/friend/settings/snapshot').then(async (response) => {
    if (!response.ok) return
    const body = await response.json()
    if (!isRecord(body)) return
    if (isRecord(body.tts) && typeof body.tts.muted === 'boolean') {
      apply(body.tts.muted)
      return
    }
    if (isRecord(body.core) && typeof body.core.muted === 'boolean') {
      apply(body.core.muted)
    }
  }).catch(() => undefined)
}
