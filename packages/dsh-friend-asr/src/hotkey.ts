/**
 * Page-level ASR hotkey: default Alt+S, capture-phase listener, record-to-rebind,
 * browser / dsh conflict rejection, persist via an injected store.
 *
 * Hold-to-talk stays available while an input is focused because we listen on
 * the capture phase. Unrelated keys are never preventDefault'd — only the
 * bound chord (and keys while recording a new chord) are consumed.
 */

export const ASR_DEFAULT_HOTKEY = 'Alt+S'
export const ASR_HOTKEY_FIELD = 'hotkey'

export type AsrKeyChord = {
  alt: boolean
  ctrl: boolean
  meta: boolean
  shift: boolean
  /** Normalized `KeyboardEvent.key` (`s`, `F5`, `Enter`, …). */
  key: string
}

export type AsrHotkeyCategory = 'browser' | 'dsh' | 'invalid'

export type AsrHotkeyAccepted = {
  ok: true
  spec: string
  chord: AsrKeyChord
}

export type AsrHotkeyRejected = {
  ok: false
  spec: string
  reason: string
  category: AsrHotkeyCategory
}

export type AsrHotkeyDecision = AsrHotkeyAccepted | AsrHotkeyRejected

export type AsrKeyEventLike = {
  type?: string
  key: string
  /** Physical key (`KeyS`, `Digit1`). Preferred over `key` on macOS Option. */
  code?: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  repeat?: boolean
  isComposing?: boolean
  target?: unknown
  preventDefault(): void
  stopPropagation(): void
}

export type AsrHotkeyListenerOptions = {
  capture?: boolean
}

export type AsrHotkeyTarget = {
  addEventListener(
    type: string,
    listener: (event: AsrKeyEventLike) => void,
    options?: AsrHotkeyListenerOptions | boolean,
  ): void
  removeEventListener(
    type: string,
    listener: (event: AsrKeyEventLike) => void,
    options?: AsrHotkeyListenerOptions | boolean,
  ): void
}

export type AsrHotkeyStore = {
  get(): string | undefined
  set(spec: string): void | Promise<void>
}

export type AsrHotkeyControllerOptions = {
  target?: AsrHotkeyTarget
  store?: AsrHotkeyStore
  initial?: string
  onDown?: () => void
  onUp?: () => void
  onChange?: (spec: string) => void
  onConflict?: (decision: AsrHotkeyRejected) => void
  onRecordCancel?: () => void
}

const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift', 'OS', 'Hyper', 'Super'])

const CAPTURE = { capture: true } as const

function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key)
}

export function normalizeAsrKey(key: string): string {
  if (key.length === 1) {
    return key.toLowerCase()
  }
  if (key === ' ') {
    return 'Space'
  }
  return key
}

/**
 * Prefer `KeyboardEvent.code` so Option+S (`key: "ß"`, `code: "KeyS"`)
 * still matches a stored `Alt+S` chord.
 */
export function physicalKeyFromEvent(event: { key: string; code?: string }): string {
  const code = event.code
  if (typeof code === 'string') {
    if (/^Key[A-Z]$/u.test(code)) {
      return code.slice(3).toLowerCase()
    }
    if (/^Digit[0-9]$/u.test(code)) {
      return code.slice(5)
    }
  }
  return normalizeAsrKey(event.key)
}

export function parseAsrHotkey(spec: string): AsrKeyChord | undefined {
  const parts = spec.split('+').map((part) => part.trim()).filter((part) => part.length > 0)
  if (parts.length === 0) {
    return undefined
  }
  const chord: AsrKeyChord = { alt: false, ctrl: false, meta: false, shift: false, key: '' }
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower === 'alt' || lower === 'option') {
      chord.alt = true
      continue
    }
    if (lower === 'ctrl' || lower === 'control') {
      chord.ctrl = true
      continue
    }
    if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win' || lower === 'super') {
      chord.meta = true
      continue
    }
    if (lower === 'shift') {
      chord.shift = true
      continue
    }
    if (chord.key.length > 0) {
      return undefined
    }
    chord.key = normalizeAsrKey(part)
  }
  if (chord.key.length === 0) {
    return undefined
  }
  return chord
}

export function formatAsrHotkey(chord: AsrKeyChord): string {
  const parts: string[] = []
  if (chord.ctrl) {
    parts.push('Ctrl')
  }
  if (chord.alt) {
    parts.push('Alt')
  }
  if (chord.shift) {
    parts.push('Shift')
  }
  if (chord.meta) {
    parts.push('Meta')
  }
  const key = chord.key.length === 1 ? chord.key.toUpperCase() : chord.key
  parts.push(key)
  return parts.join('+')
}

export function chordFromKeyEvent(event: AsrKeyEventLike): AsrKeyChord {
  return {
    alt: event.altKey === true,
    ctrl: event.ctrlKey === true,
    meta: event.metaKey === true,
    shift: event.shiftKey === true,
    key: physicalKeyFromEvent(event),
  }
}

export function chordsEqual(left: AsrKeyChord, right: AsrKeyChord): boolean {
  return (
    left.alt === right.alt
    && left.ctrl === right.ctrl
    && left.meta === right.meta
    && left.shift === right.shift
    && left.key === right.key
  )
}

export function matchAsrHotkey(event: AsrKeyEventLike, chord: AsrKeyChord): boolean {
  if (isModifierKey(event.key)) {
    return false
  }
  return chordsEqual(chordFromKeyEvent(event), chord)
}

function hasNonShiftModifier(chord: AsrKeyChord): boolean {
  return chord.alt || chord.ctrl || chord.meta
}

type ListedConflict = {
  spec: string
  category: Exclude<AsrHotkeyCategory, 'invalid'>
  reason: string
}

function listed(spec: string, category: ListedConflict['category'], reason: string): ListedConflict {
  return { spec, category, reason }
}

/**
 * Browser-reserved chords. Kept local to this module so tests assert *behavior*
 * (trying F5 is refused) rather than comparing copied tables.
 */
function browserReserved(): readonly ListedConflict[] {
  const rows: ListedConflict[] = [
    listed('F5', 'browser', '浏览器保留键：刷新页面（F5）'),
    listed('Ctrl+R', 'browser', '浏览器保留键：刷新页面（Ctrl+R）'),
    listed('Meta+R', 'browser', '浏览器保留键：刷新页面（Meta+R）'),
    listed('Ctrl+F5', 'browser', '浏览器保留键：强制刷新（Ctrl+F5）'),
    listed('Ctrl+W', 'browser', '浏览器保留键：关闭标签页（Ctrl+W）'),
    listed('Meta+W', 'browser', '浏览器保留键：关闭标签页（Meta+W）'),
    listed('Ctrl+T', 'browser', '浏览器保留键：新建标签页（Ctrl+T）'),
    listed('Meta+T', 'browser', '浏览器保留键：新建标签页（Meta+T）'),
    listed('Ctrl+N', 'browser', '浏览器保留键：新建窗口（Ctrl+N）'),
    listed('Meta+N', 'browser', '浏览器保留键：新建窗口（Meta+N）'),
    listed('Ctrl+Shift+T', 'browser', '浏览器保留键：重新打开标签页（Ctrl+Shift+T）'),
    listed('Meta+Shift+T', 'browser', '浏览器保留键：重新打开标签页（Meta+Shift+T）'),
    listed('Ctrl+L', 'browser', '浏览器保留键：聚焦地址栏（Ctrl+L）'),
    listed('Meta+L', 'browser', '浏览器保留键：聚焦地址栏（Meta+L）'),
    listed('Ctrl+P', 'browser', '浏览器保留键：打印（Ctrl+P）'),
    listed('Meta+P', 'browser', '浏览器保留键：打印（Meta+P）'),
    listed('Ctrl+S', 'browser', '浏览器保留键：保存页面（Ctrl+S）'),
    listed('Meta+S', 'browser', '浏览器保留键：保存页面（Meta+S）'),
    listed('Ctrl+Q', 'browser', '浏览器保留键：退出浏览器（Ctrl+Q）'),
    listed('Meta+Q', 'browser', '浏览器保留键：退出浏览器（Meta+Q）'),
    listed('Alt+F4', 'browser', '浏览器保留键：关闭窗口（Alt+F4）'),
    listed('Ctrl+Tab', 'browser', '浏览器保留键：切换标签页（Ctrl+Tab）'),
    listed('Ctrl+Shift+Tab', 'browser', '浏览器保留键：切换标签页（Ctrl+Shift+Tab）'),
    listed('Alt+ArrowLeft', 'browser', '浏览器保留键：后退（Alt+ArrowLeft）'),
    listed('Alt+ArrowRight', 'browser', '浏览器保留键：前进（Alt+ArrowRight）'),
    listed('Ctrl+U', 'browser', '浏览器保留键：查看源代码（Ctrl+U）'),
    listed('F12', 'browser', '浏览器保留键：开发者工具（F12）'),
    listed('Escape', 'browser', 'Escape 用于取消录制快捷键，不能设为语音热键'),
    listed('Tab', 'browser', '浏览器保留键：切换焦点（Tab）'),
    listed('F1', 'browser', '浏览器保留键：帮助（F1）'),
    listed('F3', 'browser', '浏览器保留键：查找下一个（F3）'),
    listed('F6', 'browser', '浏览器保留键：切换地址栏（F6）'),
    listed('F11', 'browser', '浏览器保留键：全屏（F11）'),
    listed('Ctrl+F', 'browser', '浏览器保留键：查找（Ctrl+F）'),
    listed('Meta+F', 'browser', '浏览器保留键：查找（Meta+F）'),
    listed('Ctrl+C', 'browser', '浏览器保留键：复制（Ctrl+C）'),
    listed('Meta+C', 'browser', '浏览器保留键：复制（Meta+C）'),
    listed('Ctrl+V', 'browser', '浏览器保留键：粘贴（Ctrl+V）'),
    listed('Meta+V', 'browser', '浏览器保留键：粘贴（Meta+V）'),
    listed('Ctrl+X', 'browser', '浏览器保留键：剪切（Ctrl+X）'),
    listed('Meta+X', 'browser', '浏览器保留键：剪切（Meta+X）'),
    listed('Ctrl+A', 'browser', '浏览器保留键：全选（Ctrl+A）'),
    listed('Meta+A', 'browser', '浏览器保留键：全选（Meta+A）'),
    listed('Ctrl+Z', 'browser', '浏览器保留键：撤销（Ctrl+Z）'),
    listed('Meta+Z', 'browser', '浏览器保留键：撤销（Meta+Z）'),
  ]
  for (let index = 1; index <= 9; index += 1) {
    rows.push(listed(`Ctrl+${index}`, 'browser', `浏览器保留键：切换到第 ${index} 个标签（Ctrl+${index}）`))
    rows.push(listed(`Meta+${index}`, 'browser', `浏览器保留键：切换到第 ${index} 个标签（Meta+${index}）`))
  }
  return rows
}

/**
 * dsh conversation / workbench chords we must not steal.
 * Official SDK does not publish a plugin-facing keymap (rc.6); this list is
 * the known in-page bindings we must not overlay.
 */
function dshReserved(): readonly ListedConflict[] {
  return [
    listed('Ctrl+Enter', 'dsh', '与 dsh 已知快捷键冲突：发送消息（Ctrl+Enter）'),
    listed('Meta+Enter', 'dsh', '与 dsh 已知快捷键冲突：发送消息（Meta+Enter）'),
    listed('Ctrl+K', 'dsh', '与 dsh 已知快捷键冲突：命令面板（Ctrl+K）'),
    listed('Meta+K', 'dsh', '与 dsh 已知快捷键冲突：命令面板（Meta+K）'),
    listed('Ctrl+/', 'dsh', '与 dsh 已知快捷键冲突：快捷帮助（Ctrl+/）'),
    listed('Meta+/', 'dsh', '与 dsh 已知快捷键冲突：快捷帮助（Meta+/）'),
  ]
}

function listedDecision(chord: AsrKeyChord): AsrHotkeyRejected | undefined {
  const candidates = [...browserReserved(), ...dshReserved()]
  for (const row of candidates) {
    const parsed = parseAsrHotkey(row.spec)
    if (parsed !== undefined && chordsEqual(parsed, chord)) {
      return { ok: false, spec: formatAsrHotkey(chord), reason: row.reason, category: row.category }
    }
  }
  return undefined
}

export function evaluateAsrHotkey(input: string | AsrKeyChord): AsrHotkeyDecision {
  const chord = typeof input === 'string' ? parseAsrHotkey(input) : input
  const spec = typeof input === 'string' ? input : formatAsrHotkey(input)
  if (chord === undefined) {
    return { ok: false, spec, reason: '无法解析快捷键', category: 'invalid' }
  }
  const formatted = formatAsrHotkey(chord)
  if (isModifierKey(chord.key) || chord.key.length === 0) {
    return { ok: false, spec: formatted, reason: '快捷键必须包含一个非修饰键', category: 'invalid' }
  }
  const reserved = listedDecision(chord)
  if (reserved !== undefined) {
    return reserved
  }
  if (!hasNonShiftModifier(chord)) {
    return {
      ok: false,
      spec: formatted,
      reason: '快捷键必须包含 Alt / Ctrl / Meta，避免在输入框里吞掉普通按键',
      category: 'invalid',
    }
  }
  return { ok: true, spec: formatted, chord }
}

export function isTextEntryTarget(target: unknown): boolean {
  if (target === null || target === undefined || typeof target !== 'object') {
    return false
  }
  const element = target as { tagName?: string; isContentEditable?: boolean }
  const tag = element.tagName?.toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true
  }
  return element.isContentEditable === true
}

export type AsrHotkeyController = {
  getSpec(): string
  getChord(): AsrKeyChord
  recording(): boolean
  attach(): void
  detach(): void
  handleEvent(event: AsrKeyEventLike): void
  startRecording(): void
  cancelRecording(): void
  setHotkey(spec: string): AsrHotkeyDecision
  dispose(): void
}

function requireChord(spec: string): AsrKeyChord {
  const parsed = parseAsrHotkey(spec)
  if (parsed === undefined) {
    const fallback = parseAsrHotkey(ASR_DEFAULT_HOTKEY)
    if (fallback === undefined) {
      throw new Error('dsh-friend-asr: default hotkey Alt+S is not parseable')
    }
    return fallback
  }
  return parsed
}

function resolveInitialSpec(options: AsrHotkeyControllerOptions): string {
  const stored = options.store?.get()
  if (typeof stored === 'string' && stored.length > 0) {
    const decision = evaluateAsrHotkey(stored)
    if (decision.ok) {
      return decision.spec
    }
  }
  if (options.initial !== undefined) {
    const decision = evaluateAsrHotkey(options.initial)
    if (decision.ok) {
      return decision.spec
    }
  }
  return ASR_DEFAULT_HOTKEY
}

export function createAsrHotkeyController(options: AsrHotkeyControllerOptions = {}): AsrHotkeyController {
  let spec = resolveInitialSpec(options)
  let chord = requireChord(spec)
  let recording = false
  let attached = false

  const onKeyDown = (event: AsrKeyEventLike): void => {
    controller.handleEvent(event)
  }
  const onKeyUp = (event: AsrKeyEventLike): void => {
    controller.handleEvent(event)
  }

  const consume = (event: AsrKeyEventLike): void => {
    event.preventDefault()
    event.stopPropagation()
  }

  const persist = (next: string): void => {
    void options.store?.set(next)
    options.onChange?.(next)
  }

  const controller: AsrHotkeyController = {
    getSpec() {
      return spec
    },
    getChord() {
      return chord
    },
    recording() {
      return recording
    },
    attach() {
      if (attached || options.target === undefined) {
        return
      }
      options.target.addEventListener('keydown', onKeyDown, CAPTURE)
      options.target.addEventListener('keyup', onKeyUp, CAPTURE)
      attached = true
    },
    detach() {
      if (!attached || options.target === undefined) {
        return
      }
      options.target.removeEventListener('keydown', onKeyDown, CAPTURE)
      options.target.removeEventListener('keyup', onKeyUp, CAPTURE)
      attached = false
    },
    handleEvent(event) {
      const kind = event.type === 'keyup' ? 'keyup' : 'keydown'

      if (recording) {
        if (kind !== 'keydown') {
          return
        }
        if (event.key === 'Escape') {
          consume(event)
          recording = false
          options.onRecordCancel?.()
          return
        }
        if (isModifierKey(event.key) || event.isComposing === true) {
          consume(event)
          return
        }
        consume(event)
        const candidate = chordFromKeyEvent(event)
        const decision = evaluateAsrHotkey(candidate)
        if (!decision.ok) {
          options.onConflict?.(decision)
          return
        }
        recording = false
        spec = decision.spec
        chord = decision.chord
        persist(spec)
        return
      }

      if (!matchAsrHotkey(event, chord)) {
        return
      }

      // Bound chord: consume so Alt+S does not insert "s" into a focused
      // input. Any other key — including letters typed in that same input —
      // is left untouched (no preventDefault).
      consume(event)
      if (kind === 'keydown') {
        if (event.repeat === true) {
          return
        }
        options.onDown?.()
        return
      }
      options.onUp?.()
    },
    startRecording() {
      recording = true
    },
    cancelRecording() {
      if (!recording) {
        return
      }
      recording = false
      options.onRecordCancel?.()
    },
    setHotkey(nextSpec) {
      const decision = evaluateAsrHotkey(nextSpec)
      if (!decision.ok) {
        options.onConflict?.(decision)
        return decision
      }
      spec = decision.spec
      chord = decision.chord
      persist(spec)
      return decision
    },
    dispose() {
      controller.detach()
      recording = false
    },
  }

  return controller
}
