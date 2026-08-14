/**
 * Test double for Cordis context-proxy semantics.
 *
 * A real Cordis `ctx` throws when a plugin reads a property that is not in
 * its `inject` list (and is not a Cordis intrinsic such as `effect`).
 * Loose plain-object fakes hide that, so client halves that treat browser
 * globals or test seams as optional `ctx.*` fields pass unit tests and then
 * fail to load in a real dsh web page.
 *
 * Services are resolved only through the Proxy `get` trap — they are never
 * own properties. `hasOwnProperty` / `Object.hasOwn` therefore miss, matching
 * production Cordis (`node_modules/@deepseek-ai/cordis/src/reflect.ts`).
 *
 * @see `node_modules/@deepseek-ai/cordis/src/reflect.ts`
 *   (`cannot get property "${prop}" without inject`)
 */

export type StrictCordisCtxValues = {
  effect?: (execute: () => () => void, label?: string) => void
  [name: string]: unknown
}

export type CreateStrictCordisCtxOptions = {
  /**
   * Service names declared on the plugin (`export const inject` /
   * `package.json#dsh.client.inject`).
   */
  inject?: readonly string[]
  values?: StrictCordisCtxValues
}

/** Mixed onto every Cordis context; not an inject entry. */
const CORDIS_INTRINSICS = ['effect', 'inject'] as const

const BOUND_SERVICE = Symbol('friend-strict-service')

/**
 * Make fake service methods depend on `this`, matching real dsh providers
 * (`SettingsProvider.update` → `this.write`).
 *
 * `const { update } = ctx.settings; update(...)` drops the receiver and
 * must throw here the same way production throws `this.write is not a function`.
 */
function bindServiceMethods(service: object): void {
  const marked = service as { [BOUND_SERVICE]?: true }
  if (marked[BOUND_SERVICE] === true) {
    return
  }
  const proto = Object.getPrototypeOf(service) as object | null
  const names = new Set<string>([
    ...Object.getOwnPropertyNames(service),
    ...(proto !== null && proto !== Object.prototype ? Object.getOwnPropertyNames(proto) : []),
  ])
  for (const key of names) {
    if (key === 'constructor') continue
    const value = (service as Record<string, unknown>)[key]
    if (typeof value !== 'function') continue
    const original = value
    Object.defineProperty(service, key, {
      configurable: true,
      writable: true,
      enumerable: true,
      value: function boundServiceMethod(this: unknown, ...args: unknown[]) {
        if (this !== service) {
          throw new Error(
            `cannot call service method "${key}" after destructuring: receiver was lost`,
          )
        }
        return original.apply(service, args)
      },
    })
  }
  Object.defineProperty(service, BOUND_SERVICE, {
    value: true,
    enumerable: false,
  })
}

export function createStrictCordisCtx(
  options: CreateStrictCordisCtxOptions = {},
): Record<string, unknown> {
  const allowed = new Set<string>([...CORDIS_INTRINSICS, ...(options.inject ?? [])])
  const values: Record<string, unknown> = { ...(options.values ?? {}) }
  for (const value of Object.values(values)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      bindServiceMethods(value)
    }
  }
  // Empty target: declared services live only in the get trap, never as own keys.
  const target = Object.create(null) as Record<string, unknown>

  return new Proxy(target, {
    get(_inner, prop, receiver) {
      if (typeof prop !== 'string') {
        return Reflect.get(_inner, prop, receiver)
      }
      if (!allowed.has(prop)) {
        throw new Error(`cannot get property "${prop}" without inject`)
      }
      return values[prop]
    },
    has(_inner, prop) {
      if (typeof prop !== 'string') {
        return Reflect.has(_inner, prop)
      }
      // Cordis `in` is true for declared services (`reflect.props`), not own keys.
      return allowed.has(prop)
    },
    getOwnPropertyDescriptor(_inner, prop) {
      if (typeof prop !== 'string') {
        return Reflect.getOwnPropertyDescriptor(_inner, prop)
      }
      return undefined
    },
    ownKeys() {
      return []
    },
  })
}
