import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared/universal'

export const CORE_SETTINGS_NAMESPACE = FRIEND_SETTINGS_NAMESPACES.core
export const CORE_ENABLED_FIELD = 'enabled' as const

/** Master switch. Missing / non-boolean values stay on so a stale document does not blank the stage. */
export function readCoreEnabled(section: unknown): boolean {
  if (typeof section !== 'object' || section === null) return true
  return (section as Record<string, unknown>)[CORE_ENABLED_FIELD] !== false
}
