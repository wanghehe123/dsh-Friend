import type { FriendSettingsNamespace } from './namespaces.ts'

/**
 * Minimal client settings-scope binder.
 *
 * Official: `ctx.settingsScope.bind({ namespace })`
 * (`@deepseek-ai/dsh-client-ui-settings` / contract in
 * `@deepseek-ai/dsh-client-runtime`). The spec field is `namespace`.
 *
 * Replacement: if `bind` is renamed, only this function changes.
 */

export interface FriendSettingsScopeSnapshot<T> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  base: unknown
  user: unknown
  revision: number | undefined
  writable: boolean
  mode: 'host' | 'memory'
}

export interface FriendSettingsScopeSpec<T> {
  namespace: FriendSettingsNamespace
  decode?: (section: unknown) => T | undefined
}

export interface FriendSettingsScope<T> {
  getSnapshot(): FriendSettingsScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

export interface FriendSettingsScopeBinder {
  bind<T>(spec: FriendSettingsScopeSpec<T>): FriendSettingsScope<T>
}

/**
 * Bind one namespace scope on the client plugin lifecycle.
 *
 * Official: `settingsScope.bind(spec)` (`@deepseek-ai/dsh-client-ui-settings`).
 * Pass `{ namespace }` using {@link FriendSettingsNamespace} constants from
 * `./namespaces.ts` — never dotted strings.
 *
 * Replacement: if `bind` is renamed, only this function changes.
 */
export function bindSettingsClient<T>(
  settingsScope: FriendSettingsScopeBinder,
  spec: FriendSettingsScopeSpec<T>,
): FriendSettingsScope<T> {
  return settingsScope.bind(spec)
}
