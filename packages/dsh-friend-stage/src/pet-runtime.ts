import { readCoreStageVisible } from './core-gate.ts'

export const FRIEND_STAGE_RUNTIME_PATH = '/friend/stage/runtime'
export const FRIEND_SETTINGS_SNAPSHOT_PATH = '/friend/settings/snapshot'
export const PET_RUNTIME_POLL_MS = 1_000
export const PET_LIVE2D_CANVAS_ID = 'friend-live2d'

export type PetRuntimeDocument = {
  getElementById(id: string): { hidden: boolean | string } | null
}

export function runtimeEnabledFromUnknown(value: unknown): boolean | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const enabled = (value as { enabled?: unknown }).enabled
  return typeof enabled === 'boolean' ? enabled : undefined
}

export function coreVisibleFromSettingsSnapshot(value: unknown): boolean | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const core = (value as { core?: unknown }).core
  if (core === null || typeof core !== 'object') return undefined
  return readCoreStageVisible(core)
}

export function applyPetPageEnabled(
  doc: PetRuntimeDocument,
  enabled: boolean,
  canvasId = PET_LIVE2D_CANVAS_ID,
): void {
  const canvas = doc.getElementById(canvasId)
  if (canvas !== null) canvas.hidden = !enabled
}

export async function fetchRuntimeEnabled(
  fetchImpl: (input: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>,
  path = FRIEND_STAGE_RUNTIME_PATH,
): Promise<boolean | undefined> {
  try {
    const response = await fetchImpl(path)
    if (!response.ok) return undefined
    return runtimeEnabledFromUnknown(await response.json())
  } catch {
    return undefined
  }
}

export async function fetchSettingsStageVisible(
  fetchImpl: (input: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>,
  path = FRIEND_SETTINGS_SNAPSHOT_PATH,
): Promise<boolean | undefined> {
  try {
    const response = await fetchImpl(path)
    if (!response.ok) return undefined
    return coreVisibleFromSettingsSnapshot(await response.json())
  } catch {
    return undefined
  }
}

/** Prefer the settings snapshot (same source as the plugin card). Runtime is fallback. */
export async function fetchStageVisible(
  fetchImpl: (input: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>,
): Promise<boolean | undefined> {
  const fromSnapshot = await fetchSettingsStageVisible(fetchImpl)
  if (fromSnapshot !== undefined) return fromSnapshot
  return fetchRuntimeEnabled(fetchImpl)
}
