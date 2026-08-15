import type {
  OverlayDocument,
  OverlayElement,
  OverlayPointerEvent,
  OverlaySettingsScope,
  OverlayWindow,
} from '../../src/overlay.ts'

export type FakeOverlayElement = OverlayElement & {
  readonly tagName: string
  readonly children: FakeOverlayElement[]
  readonly listeners: Map<string, Array<(event: OverlayPointerEvent) => void>>
  capturedPointerId: number | undefined
  dispatch(type: string, event?: Partial<OverlayPointerEvent>): OverlayPointerEvent
}

export type FakeOverlayDocument = OverlayDocument & {
  readonly listeners: Map<string, Array<(event: OverlayPointerEvent) => void>>
  readonly attached: FakeOverlayElement[]
  dispatch(type: string, event?: Partial<OverlayPointerEvent>): OverlayPointerEvent
}

const VOID_TAGS = new Set(['input', 'br', 'img', 'hr'])

export function createFakeOverlayDocument(): FakeOverlayDocument {
  const listeners = new Map<string, Array<(event: OverlayPointerEvent) => void>>()
  const attached: FakeOverlayElement[] = []
  const doc: FakeOverlayDocument = {
    listeners,
    attached,
    body: {
      appendChild(node) {
        attached.push(node as FakeOverlayElement)
      },
    },
    createElement(tag) {
      return createFakeOverlayElement(tag)
    },
    querySelector(selector) {
      for (const node of attached) {
        const found = querySelectorDeep(node as FakeOverlayElement, selector)
        if (found !== null) return found
      }
      return null
    },
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? []
      list.push(listener)
      listeners.set(type, list)
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type)
      if (list === undefined) return
      listeners.set(type, list.filter((item) => item !== listener))
    },
    dispatch(type, event = {}) {
      const full = pointerEvent(undefined, event)
      for (const listener of listeners.get(type) ?? []) listener(full)
      return full
    },
  }
  return doc
}

export function createFakeOverlayWindow(): OverlayWindow & { events: string[]; assigned: string[] } {
  const events: string[] = []
  const assigned: string[] = []
  const listeners = new Map<string, Array<(event: { type: string; detail?: unknown }) => void>>()
  return {
    events,
    assigned,
    innerWidth: 1280,
    innerHeight: 800,
    location: {
      assign(url: string) {
        assigned.push(url)
      },
    },
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? []
      list.push(listener)
      listeners.set(type, list)
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type)
      if (list === undefined) return
      listeners.set(type, list.filter((item) => item !== listener))
    },
    dispatchEvent(event) {
      events.push(event.type)
      for (const listener of listeners.get(event.type) ?? []) listener(event)
      return true
    },
  }
}

export function createMemorySettingsScope(initial: Record<string, unknown> = {}): OverlaySettingsScope & {
  value: Record<string, unknown>
  notify(): void
} {
  const listeners = new Set<() => void>()
  const scope = {
    value: { ...initial },
    getSnapshot() {
      return { value: scope.value }
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async set(field: string, value: unknown) {
      scope.value[field] = value
      scope.notify()
    },
    notify() {
      for (const listener of listeners) listener()
    },
  }
  return scope
}

export function querySelectorDeep(root: FakeOverlayElement, selector: string): FakeOverlayElement | null {
  if (matchesSelector(root, selector)) return root
  for (const child of root.children) {
    const found = querySelectorDeep(child, selector)
    if (found !== null) return found
  }
  return null
}

function createFakeOverlayElement(tag: string): FakeOverlayElement {
  const children: FakeOverlayElement[] = []
  const listeners = new Map<string, Array<(event: OverlayPointerEvent) => void>>()
  const dataset: Record<string, string> = {}
  const attributes: Record<string, string> = {}
  let innerHTML = ''

  const element: FakeOverlayElement = {
    tagName: tag.toLowerCase(),
    children,
    listeners,
    capturedPointerId: undefined,
    id: '',
    className: '',
    hidden: false,
    style: { cssText: '' },
    textContent: null,
    dataset,
    get innerHTML() {
      return innerHTML
    },
    set innerHTML(value: string) {
      innerHTML = value
      children.length = 0
      hydrateHtml(element, value)
    },
    appendChild(node) {
      children.push(node as FakeOverlayElement)
      return node
    },
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? []
      list.push(listener)
      listeners.set(type, list)
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type)
      if (list === undefined) return
      listeners.set(type, list.filter((item) => item !== listener))
    },
    setAttribute(name, value) {
      attributes[name] = value
      if (name === 'id') element.id = value
      if (name === 'class' || name === 'className') element.className = value
      if (name === 'hidden') element.hidden = value !== 'false'
      if (name.startsWith('data-')) dataset[dataToCamel(name)] = value
    },
    getAttribute(name) {
      if (name === 'id') return element.id || null
      return attributes[name] ?? null
    },
    querySelector(selector) {
      for (const child of children) {
        const found = querySelectorDeep(child, selector)
        if (found !== null) return found
      }
      return null
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 280, height: 360 }
    },
    setPointerCapture(pointerId) {
      element.capturedPointerId = pointerId
    },
    releasePointerCapture(pointerId) {
      if (element.capturedPointerId === pointerId) element.capturedPointerId = undefined
    },
    dispatch(type, event = {}) {
      const full = pointerEvent(element, event)
      for (const listener of listeners.get(type) ?? []) listener(full)
      return full
    },
  }
  return element
}

function pointerEvent(
  currentTarget: FakeOverlayElement | undefined,
  event: Partial<OverlayPointerEvent>,
): OverlayPointerEvent {
  return {
    clientX: 0,
    clientY: 0,
    preventDefault() {},
    stopPropagation() {},
    ...(currentTarget === undefined ? {} : { currentTarget }),
    ...event,
  }
}

function matchesSelector(element: FakeOverlayElement, selector: string): boolean {
  if (selector.startsWith('#')) return element.id === selector.slice(1)
  if (/^[a-z][a-z0-9-]*$/iu.test(selector)) return element.tagName === selector.toLowerCase()
  const attrEq = /^\[([a-z0-9:-]+)="([^"]*)"\]$/iu.exec(selector)
  if (attrEq !== null && attrEq[1] !== undefined && attrEq[2] !== undefined) {
    if (attrEq[1].startsWith('data-')) return element.dataset[dataToCamel(attrEq[1])] === attrEq[2]
    return element.getAttribute(attrEq[1]) === attrEq[2]
  }
  const attr = /^\[([a-z0-9:-]+)\]$/iu.exec(selector)
  if (attr !== null && attr[1] !== undefined) {
    if (attr[1].startsWith('data-')) return element.dataset[dataToCamel(attr[1])] !== undefined
    return element.getAttribute(attr[1]) !== null
  }
  return false
}

function dataToCamel(name: string): string {
  return name.slice(5).replace(/-([a-z])/gu, (_all, letter: string) => letter.toUpperCase())
}

function hydrateHtml(parent: FakeOverlayElement, html: string): void {
  const stack: FakeOverlayElement[] = [parent]
  const tokens = html.matchAll(/<\/?([a-zA-Z0-9]+)([^>]*)\/?>|([^<]+)/gu)
  for (const token of tokens) {
    const [full, tag, rawAttrs, text] = token
    if (text !== undefined) {
      const trimmed = text.trim()
      const current = stack[stack.length - 1]
      if (trimmed.length > 0 && current !== undefined) current.textContent = trimmed
      continue
    }
    if (tag === undefined) continue
    if (full.startsWith('</')) {
      if (stack.length > 1) stack.pop()
      continue
    }
    const current = stack[stack.length - 1]
    if (current === undefined) continue
    const node = createFakeOverlayElement(tag)
    applyAttributes(node, rawAttrs ?? '')
    current.appendChild(node)
    const selfClosing = full.endsWith('/>') || VOID_TAGS.has(tag.toLowerCase())
    if (!selfClosing) stack.push(node)
  }
}

function applyAttributes(element: FakeOverlayElement, raw: string): void {
  for (const match of raw.matchAll(/([:@A-Za-z0-9-]+)(?:=(?:"([^"]*)"|'([^']*)'|(\S+)))?/gu)) {
    const name = match[1]
    if (name === undefined) continue
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (name === 'hidden' && value === '') {
      element.hidden = true
      element.setAttribute('hidden', '')
      continue
    }
    element.setAttribute(name, value)
  }
}
