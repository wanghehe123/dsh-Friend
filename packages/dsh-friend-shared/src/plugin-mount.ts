/**
 * Official host-half mount marker for every dsh-Friend plugin.
 *
 * dsh does not yet expose a plugin-inventory query, so live smoke
 * (`scripts/smoke.mjs`) treats this exact line as proof that `apply()` ran.
 * If dsh later adds such an API, replace only {@link emitPluginMount} (and
 * the smoke matcher that reads {@link formatPluginMountLog}). Do not change
 * the `logPluginMount(name)` calls in each package's host `apply()`.
 */
export const PLUGIN_MOUNT_LOG_EVENT = 'dsh-friend:plugin-mount'

/** Machine-parseable mount line. Stable so smoke can grep it. */
export function formatPluginMountLog(name: string): string {
  return `${PLUGIN_MOUNT_LOG_EVENT} ${name}`
}

/**
 * Emit the host `apply()` mount marker. One line, no extra fields.
 *
 * @param name Plugin id as logged to stdout — usually `export const name`.
 *   Smoke accepts either the scoped npm name or the unscoped short id.
 */
export function logPluginMount(name: string): void {
  emitPluginMount(name)
}

/**
 * Adapter behind {@link logPluginMount}.
 *
 * Today: one `console.info` line. Tomorrow: a dsh inventory probe, a
 * structured logger, or a no-op if the host can list mounted plugins.
 * Keep this the only place that knows *how* a mount is recorded.
 */
function emitPluginMount(name: string): void {
  console.info(formatPluginMountLog(name))
}
