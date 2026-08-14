/**
 * settingsScope for hosts that do not inject the official dsh binder
 * (standalone pet IIFE). Reads GET /friend/settings/snapshot and writes
 * POST /friend/settings/patch so hotkey/language survive host restart.
 */
import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared/universal'

import {
  readFriendAsrSettings,
  type AsrSettingsBinder,
  type AsrSettingsScope,
  type FriendAsrSettings,
} from './settings.ts'

export const FRIEND_SETTINGS_SNAPSHOT_PATH = '/friend/settings/snapshot' as const
export const FRIEND_SETTINGS_PATCH_PATH = '/friend/settings/patch' as const
export const FRIEND_ASR_SETTINGS_NAMESPACE = FRIEND_SETTINGS_NAMESPACES.asr

export type SnapshotAsrSettingsBinderOptions = {
  fetch?: typeof fetch
  snapshotPath?: string
  patchPath?: string
  /** 0 disables polling (default). Local `set()` is not overwritten. */
  pollMs?: number
  /** Seed before the first fetch. Full snapshot `{ asr }` or a raw section. */
  initial?: unknown
}

export function createSnapshotAsrSettingsBinder(
  options: SnapshotAsrSettingsBinderOptions = {},
): AsrSettingsBinder {
  const snapshotPath = options.snapshotPath ?? FRIEND_SETTINGS_SNAPSHOT_PATH
  const patchPath = options.patchPath ?? FRIEND_SETTINGS_PATCH_PATH
  const pollMs = options.pollMs ?? 0

  return {
    bind(spec) {
      const decode = spec.decode ?? ((section: unknown) => readFriendAsrSettings(section))
      let value: FriendAsrSettings = decode(asrSectionFromSnapshot(options.initial))
        ?? readFriendAsrSettings(options.initial)
      let revision = 0
      let writeGeneration = 0
      const listeners = new Set<() => void>()
      let pollTimer: ReturnType<typeof setInterval> | undefined
      let closed = false

      const notify = (): void => {
        for (const listener of listeners) {
          listener()
        }
      }

      const applySection = (section: unknown): void => {
        value = decode(section) ?? readFriendAsrSettings(section)
        revision += 1
        notify()
      }

      const resolveFetch = (): typeof fetch | undefined => (
        options.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch
      )

      const refresh = async (): Promise<void> => {
        const impl = resolveFetch()
        if (impl === undefined) {
          return
        }
        const generation = writeGeneration
        try {
          const response = await impl(snapshotPath, { method: 'GET' })
          if (!response.ok) {
            return
          }
          const payload: unknown = await response.json()
          if (closed || generation !== writeGeneration) {
            return
          }
          applySection(asrSectionFromSnapshot(payload))
        } catch {
          // keep the last known value
        }
      }

      const persistPatch = async (patch: Record<string, unknown>): Promise<void> => {
        const impl = resolveFetch()
        if (impl === undefined) {
          return
        }
        try {
          await impl(patchPath, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              namespace: FRIEND_ASR_SETTINGS_NAMESPACE,
              patch,
            }),
          })
        } catch {
          // keep the local value; host persist is best-effort
        }
      }

      void refresh()

      const startPoll = (): void => {
        if (pollMs <= 0 || pollTimer !== undefined) {
          return
        }
        pollTimer = setInterval(() => {
          void refresh()
        }, pollMs)
      }

      const stopPoll = (): void => {
        if (pollTimer === undefined) {
          return
        }
        clearInterval(pollTimer)
        pollTimer = undefined
      }

      const scope: AsrSettingsScope = {
        getSnapshot: () => ({
          status: 'ready',
          value,
          base: value,
          user: value,
          revision,
          writable: true,
          mode: 'memory',
        }),
        subscribe(listener) {
          listeners.add(listener)
          startPoll()
          return () => {
            listeners.delete(listener)
            if (listeners.size === 0) {
              stopPoll()
              closed = true
            }
          }
        },
        async set(field, fieldValue) {
          writeGeneration += 1
          applySection({ ...value, [field]: fieldValue })
          await persistPatch({ [field]: fieldValue })
        },
        async unset(field) {
          writeGeneration += 1
          const next: Record<string, unknown> = { ...value }
          delete next[field]
          applySection(next)
        },
      }
      return scope
    },
  }
}

function asrSectionFromSnapshot(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object') {
    return undefined
  }
  const record = payload as Record<string, unknown>
  if (record.asr !== undefined) {
    return record.asr
  }
  return payload
}
