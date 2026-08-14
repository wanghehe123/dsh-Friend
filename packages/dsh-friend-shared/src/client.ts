/**
 * Client half of `@wishp3/dsh-friend-shared`.
 *
 * Import from `@wishp3/dsh-friend-shared/client` **only** inside the dsh web
 * loader. Built `lib/client.js` is a classic-script
 * `window.__ModuleLoader__.load({...})` payload — Node, vitest, and bundlers
 * cannot treat it as ordinary ESM.
 *
 * Re-exports the platform-neutral `./universal` barrel plus client settings
 * binders. Do not add `node:` or host adapters here.
 *
 * Client packages that need only constants must import
 * `@wishp3/dsh-friend-shared/universal` (inlined at build time), not this
 * payload and not the host `.` export.
 *
 * @see `./universal.ts` — naked ESM constants / pure helpers
 * @see `./index.ts` — host `.` export (Node-only)
 */
export * from './universal.ts'
export {
  bindSettingsClient,
  type FriendSettingsScope,
  type FriendSettingsScopeBinder,
  type FriendSettingsScopeSnapshot,
  type FriendSettingsScopeSpec,
} from './compat/settings-client.ts'

/** Shared client package; feature packages own their visible UI. */
export const inject: string[] = []

export function apply(): void {}
