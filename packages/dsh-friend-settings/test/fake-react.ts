/**
 * Minimal React stand-in so overlay tests can render ConfigOverlay
 * without adding a UI library. Mirrors the platform seed surface.
 */
import { createRequire } from 'node:module'
import Module from 'node:module'

export type VNode = {
  type: unknown
  props: Record<string, unknown>
  children: unknown[]
}

type HookState = { kind: 'state'; value: unknown } | { kind: 'memo'; deps: readonly unknown[]; value: unknown }

let hooks: HookState[] = []
let hookIndex = 0
let renderRoot: (() => unknown) | undefined

export const fakeReact = {
  createElement(type: unknown, props?: object | null, ...children: unknown[]): VNode {
    return {
      type,
      props: (props ?? {}) as Record<string, unknown>,
      children: children.flat(),
    }
  },
  useState<S>(initial: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void] {
    const index = hookIndex
    hookIndex += 1
    const existing = hooks[index]
    if (existing === undefined || existing.kind !== 'state') {
      hooks[index] = {
        kind: 'state',
        value: typeof initial === 'function' ? (initial as () => S)() : initial,
      }
    }
    const slot = hooks[index] as { kind: 'state'; value: S }
    return [
      slot.value,
      (value) => {
        slot.value = typeof value === 'function' ? (value as (prev: S) => S)(slot.value) : value
      },
    ]
  },
  useMemo<T>(factory: () => T, deps: readonly unknown[]): T {
    const index = hookIndex
    hookIndex += 1
    const existing = hooks[index]
    if (existing !== undefined && existing.kind === 'memo' && sameDeps(existing.deps, deps)) {
      return existing.value as T
    }
    const value = factory()
    hooks[index] = { kind: 'memo', deps, value }
    return value
  },
  useEffect(effect: () => void | (() => void)): void {
    effect()
  },
}

export function resetFakeReact(): void {
  hooks = []
  hookIndex = 0
  renderRoot = undefined
}

export function render(element: unknown): unknown {
  hookIndex = 0
  return realize(element)
}

export function rerender(): unknown {
  if (renderRoot === undefined) {
    throw new Error('rerender() called before mount()')
  }
  hookIndex = 0
  return realize(renderRoot())
}

export function mount(factory: () => unknown): unknown {
  resetFakeReact()
  renderRoot = factory
  return render(factory())
}

function realize(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(realize)
  }
  if (!isVNode(node)) {
    return node
  }
  if (typeof node.type === 'function') {
    const rendered = (node.type as (props: Record<string, unknown>) => unknown)({
      ...node.props,
      children: node.children,
    })
    return realize(rendered)
  }
  return {
    type: node.type,
    props: node.props,
    children: node.children.map(realize),
  }
}

function isVNode(value: unknown): value is VNode {
  return value !== null && typeof value === 'object' && 'type' in value && 'props' in value && 'children' in value
}

function sameDeps(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  return left.every((item, index) => item === right[index])
}

export function walk(node: unknown, visit: (vnode: VNode) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (!isVNode(node)) {
    return
  }
  visit(node)
  for (const child of node.children) walk(child, visit)
}

export function queryAll(node: unknown, predicate: (vnode: VNode) => boolean): VNode[] {
  const found: VNode[] = []
  walk(node, (vnode) => {
    if (predicate(vnode)) found.push(vnode)
  })
  return found
}

export function queryByField(node: unknown, field: string): VNode | undefined {
  return queryAll(node, (vnode) => vnode.props['data-field'] === field)[0]
}

export function queryByAction(node: unknown, action: string): VNode | undefined {
  return queryAll(node, (vnode) => vnode.props['data-action'] === action)[0]
}

export function installFakeReact(): void {
  ;(globalThis as { __dshFriendReact__?: typeof fakeReact }).__dshFriendReact__ = fakeReact
  const loader = Module as typeof Module & {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown
  }
  const original = loader._load
  loader._load = function patched(request: string, parent: unknown, isMain: boolean): unknown {
    if (request === 'react') {
      return fakeReact
    }
    return original.call(this, request, parent, isMain)
  }
  const globalRequire = (globalThis as { require?: (id: string) => unknown }).require
  ;(globalThis as { require: (id: string) => unknown }).require = (id: string) => {
    if (id === 'react') {
      return fakeReact
    }
    if (typeof globalRequire === 'function') {
      return globalRequire(id)
    }
    return createRequire(import.meta.url)(id)
  }
}
