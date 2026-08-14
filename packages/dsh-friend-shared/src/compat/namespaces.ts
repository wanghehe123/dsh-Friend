/**
 * Official settings namespaces for dsh-Friend.
 *
 * `@deepseek-ai/dsh-settings` `settingsNamespace()` only accepts
 * `/^[a-z][a-z0-9-]*$/`. Dotted names such as `friend.core` throw.
 * Feature packages MUST import these constants instead of writing strings.
 *
 * Replacement: if the official pattern ever allows dots, keep kebab anyway
 * so stored documents stay stable.
 */
export const SETTINGS_NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/

export const FRIEND_SETTINGS_NAMESPACES = {
  core: 'friend-core',
  persona: 'friend-persona',
  memory: 'friend-memory',
  tts: 'friend-tts',
  asr: 'friend-asr',
  stage: 'friend-stage',
  growth: 'friend-growth',
  reactions: 'friend-reactions',
  pet: 'friend-pet',
} as const

export type FriendSettingsNamespace =
  (typeof FRIEND_SETTINGS_NAMESPACES)[keyof typeof FRIEND_SETTINGS_NAMESPACES]
