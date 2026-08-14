/**
 * Platform-neutral half of `@wish233/dsh-friend-shared`.
 *
 * Import from `@wish233/dsh-friend-shared/universal`. Built as ordinary ESM
 * (`lib/universal.js`) — no `window.__ModuleLoader__` wrapper, no `node:`
 * builtins, no browser globals. Safe in Node, vitest, and client-half source.
 *
 * Client builds **must inline** this subpath. It is not a dsh web platform
 * seed (`shared/web-platform.ts`); a factory `require()` of this specifier
 * throws `require missed the module table` at runtime.
 *
 * Do **not** put host adapters, `node:*`, or `window` / `document` here.
 *
 * @see `./index.ts` — host `.` export (Node-only; pulls `node:http` / dsh host)
 * @see `./client.ts` — `./client` export (classic-script ModuleLoader payload)
 */
export {
  FRIEND_SETTINGS_NAMESPACES,
  SETTINGS_NAMESPACE_PATTERN,
  type FriendSettingsNamespace,
} from './compat/namespaces.ts'
export {
  FRIEND_EVENTS_PATH,
  type FriendPushEvent,
  type FriendPushEventType,
} from './compat/events.ts'
