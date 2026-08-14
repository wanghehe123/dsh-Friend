import type { Context } from '@deepseek-ai/cordis'
import {
  installSettingsSection,
  settingsNamespace,
  type SettingsSectionHooks,
} from '@deepseek-ai/dsh-settings'
import type z from '@deepseek-ai/schemastery'

import type { FriendSettingsNamespace } from './namespaces.ts'

export type { SettingsSectionHooks }

const NOOP_SETTINGS_HOOKS: SettingsSectionHooks<unknown> = {
  setSource: () => {},
  onChange: () => {},
}

/**
 * Host `ctx.settings` methods Friend actually calls.
 *
 * Real shape measured on rc.6, source: `dsh-friend:shape-diag ctx.settings`:
 * `FileSettingsProvider` → `SettingsProvider`; `get#1`, `update#3`,
 * `replace#3`, `mutate#3`, `write#4` (internal). There is no `set`.
 */
export interface FriendHostSettings {
  get(namespace: string): unknown
  update(namespace: string, patch: Record<string, unknown>): Promise<void>
}

/**
 * Call through the live settings object so class methods keep `this`.
 *
 * Real shape measured on rc.6, source:
 * `dsh-friend:shape-diag settings.update.call({}) threw this.write is not a function`.
 * `SettingsProvider.update` is a prototype method that calls `this.write(...)`.
 * Extracting `const { update } = ctx.settings` (or passing `update: settings.update`
 * as a callback) drops the receiver and throws.
 *
 * Always pass the live `ctx.settings` into this helper — it cannot recover
 * `this` from an already-unbound function.
 */
export function bindHostSettings(settings: FriendHostSettings): FriendHostSettings {
  return {
    get(namespace) {
      return settings.get(namespace)
    },
    update(namespace, patch) {
      return settings.update(namespace, patch)
    },
  }
}

/**
 * Bind one Friend settings namespace on the host.
 *
 * Official: `installSettingsSection(ctx, settingsNamespace(ns), schema, entry, hooks)`
 * (`@deepseek-ai/dsh-settings`). That helper already registers + watches when
 * `ctx.settings` exists, and falls back to the composition entry otherwise.
 *
 * `ns` must be a {@link FriendSettingsNamespace} kebab constant — dotted
 * names such as `friend.core` fail `settingsNamespace()`'s
 * `/^[a-z][a-z0-9-]*$/` check.
 *
 * Replacement: if `installSettingsSection` moves, only this function changes.
 */
export function bindSettingsHost<T>(
  ctx: Context,
  ns: FriendSettingsNamespace,
  schema: z<T>,
  entry: T,
  hooks: SettingsSectionHooks<T>,
): void {
  installSettingsSection(ctx, settingsNamespace(ns), schema, entry, hooks)
}

/**
 * Production registration path. Real Cordis `ctx` always has `inject`;
 * `installSettingsSection` then registers when `ctx.settings` is live.
 *
 * Unit-test fakes are plain objects without `inject` — skip rather than
 * throw, so existing apply() tests keep working. Tests that want to prove
 * registration must pass a ctx with `inject` (see
 * {@link createFriendSettingsInstallProbe}).
 *
 * Optional `schema` override is the test seam. Production callers pass the
 * real schemastery schema from {@link Schema}.
 */
export function registerFriendSettings<T>(
  ctx: object,
  ns: FriendSettingsNamespace,
  schema: z<T>,
  entry: T,
  hooks?: SettingsSectionHooks<T>,
): void {
  if (typeof (ctx as { inject?: unknown }).inject !== 'function') {
    return
  }
  bindSettingsHost(
    ctx as Context,
    ns,
    schema,
    entry,
    (hooks ?? NOOP_SETTINGS_HOOKS) as SettingsSectionHooks<T>,
  )
}

export type FriendSettingsInstallRecord = {
  ns: string
  schema: unknown
  options: unknown
}

export type FriendSettingsInstallProbe = {
  inject: (
    deps: readonly string[],
    callback: (sctx: {
      settings: {
        register: (
          ns: string,
          schema: unknown,
          options?: unknown,
        ) => { get: () => unknown; watch: () => () => void }
      }
      effect: (execute: () => void) => void
    }) => void,
  ) => void
  fiber: { state: number }
  registered: FriendSettingsInstallRecord[]
}

/**
 * Minimal `ctx.inject` double that records `settings.register` calls.
 * Used by apply() tests to prove the production registration path ran.
 */
export function createFriendSettingsInstallProbe(): FriendSettingsInstallProbe {
  const registered: FriendSettingsInstallRecord[] = []
  return {
    fiber: { state: 0 },
    registered,
    inject(deps, callback) {
      callback({
        settings: {
          register(ns, schema, options) {
            registered.push({ ns, schema, options })
            return {
              get: () => undefined,
              watch: () => () => undefined,
            }
          },
        },
        effect(execute) {
          execute()
        },
      })
    },
  }
}
