import { FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared/universal'

export const CORE_SETTINGS_NAMESPACE = FRIEND_SETTINGS_NAMESPACES.core
export const CORE_ENABLED_FIELD = 'enabled' as const
export const CORE_FLOAT_ENABLED_FIELD = 'floatEnabled' as const

/** Master switch. Missing / non-boolean values stay on so a stale document does not blank the stage. */
export function readCoreEnabled(section: unknown): boolean {
  if (typeof section !== 'object' || section === null) return true
  return (section as Record<string, unknown>)[CORE_ENABLED_FIELD] !== false
}

/** Config-center 悬浮层 toggle. Missing stays on. */
export function readCoreFloatEnabled(section: unknown): boolean {
  if (typeof section !== 'object' || section === null) return true
  return (section as Record<string, unknown>)[CORE_FLOAT_ENABLED_FIELD] !== false
}

/** Host is shown only when the plugin and the float toggle are both on. */
export function readCoreStageVisible(section: unknown): boolean {
  return readCoreEnabled(section) && readCoreFloatEnabled(section)
}
