/**
 * Validate POST /friend/settings/patch bodies.
 *
 * Only registered kebab `friend-*` namespaces are writable. Secret fields
 * may appear in `patch` (the host store keeps them); the HTTP response
 * must still go through {@link projectClientSettings}.
 */
import {
  FRIEND_SETTINGS_NAMESPACES,
  type FriendHostSettings,
  type FriendSettingsNamespace,
} from '@wish233/dsh-friend-shared'

import type { SettingsReader } from './project.ts'
import { isRecord } from './sanitize.ts'

export const ILLEGAL_PATCH_KEYS = ['__proto__', 'prototype', 'constructor'] as const

const REGISTERED_NAMESPACES = new Set<string>(Object.values(FRIEND_SETTINGS_NAMESPACES))

export type SettingsPatchRequest = {
  namespace: FriendSettingsNamespace
  patch: Record<string, unknown>
}

export type ParseSettingsPatchResult =
  | { ok: true; value: SettingsPatchRequest }
  | { ok: false; error: string }

export function isRegisteredFriendNamespace(value: string): value is FriendSettingsNamespace {
  return REGISTERED_NAMESPACES.has(value)
}

export function asFriendHostSettings(
  settings: (SettingsReader & { update?: FriendHostSettings['update'] }) | undefined,
): FriendHostSettings | undefined {
  if (settings === undefined || typeof settings.update !== 'function') {
    return undefined
  }
  return settings as FriendHostSettings
}

export function parseSettingsPatch(body: unknown): ParseSettingsPatchResult {
  if (!isRecord(body)) {
    return { ok: false, error: 'body must be an object' }
  }
  const namespace = body.namespace
  if (typeof namespace !== 'string' || namespace.trim().length === 0) {
    return { ok: false, error: 'namespace is required' }
  }
  if (!isRegisteredFriendNamespace(namespace)) {
    return { ok: false, error: `unknown namespace: ${namespace}` }
  }
  const patch = body.patch
  if (!isRecord(patch)) {
    return { ok: false, error: 'patch must be an object' }
  }
  for (const key of Object.keys(patch)) {
    if ((ILLEGAL_PATCH_KEYS as readonly string[]).includes(key)) {
      return { ok: false, error: 'illegal patch key' }
    }
  }
  return { ok: true, value: { namespace, patch } }
}
