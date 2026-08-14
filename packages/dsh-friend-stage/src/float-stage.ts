import {
  DEFAULT_FLOAT_HEIGHT,
  DEFAULT_FLOAT_WIDTH,
  MIN_FLOAT_HEIGHT,
  MIN_FLOAT_WIDTH,
  STAGE_FLOAT_HEIGHT_FIELD,
  STAGE_FLOAT_HIDDEN_FIELD,
  STAGE_FLOAT_LEFT_FIELD,
  STAGE_FLOAT_MUTED_FIELD,
  STAGE_FLOAT_TOP_FIELD,
  STAGE_FLOAT_WIDTH_FIELD,
  readStageUiSettings,
  type StageUiSettings,
} from './live2d/stage-settings.ts'

export type FloatCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
export type ResizeHandle = FloatCorner

export type FloatPoint = Readonly<{ x: number; y: number }>
export type FloatViewport = Readonly<{ width: number; height: number }>
export type FloatRect = Readonly<{ left: number; top: number; width: number; height: number }>

export type FloatPersist = {
  get(): StageUiSettings
  set(field: string, value: unknown): Promise<void>
}

export const DSH_PET_SELECTORS = [
  '[data-dsh-pet]',
  '#dsh-pet',
  '.dsh-pet',
  '[class*="dsh-pet"]',
  '[id*="dsh-pet"]',
] as const

export const FLOAT_Z_INDEX = 2_147_483_000

export function detectDshPet(root: { querySelector(selector: string): unknown }): boolean {
  return DSH_PET_SELECTORS.some((selector) => root.querySelector(selector) != null)
}

export function chooseAvoidingCorner(petPresent: boolean, preferred: FloatCorner = 'bottom-right'): FloatCorner {
  if (!petPresent) return preferred
  if (preferred === 'bottom-right') return 'bottom-left'
  if (preferred === 'bottom-left') return 'bottom-right'
  if (preferred === 'top-right') return 'top-left'
  return 'top-right'
}

export function defaultFloatRect(viewport: FloatViewport, corner: FloatCorner): FloatRect {
  const width = Math.min(DEFAULT_FLOAT_WIDTH, Math.max(MIN_FLOAT_WIDTH, viewport.width - 16))
  const height = Math.min(DEFAULT_FLOAT_HEIGHT, Math.max(MIN_FLOAT_HEIGHT, viewport.height - 16))
  return clampFloatRect(rectForCorner(corner, width, height, viewport), viewport)
}

export function rectFromSettings(settings: StageUiSettings, viewport: FloatViewport, corner: FloatCorner): FloatRect {
  if (settings.floatLeft === undefined || settings.floatTop === undefined) {
    return defaultFloatRect(viewport, corner)
  }
  return clampFloatRect({
    left: settings.floatLeft,
    top: settings.floatTop,
    width: settings.floatWidth,
    height: settings.floatHeight,
  }, viewport)
}

export function applyPointerDrag(
  start: FloatRect,
  from: FloatPoint,
  to: FloatPoint,
  viewport: FloatViewport,
): FloatRect {
  return clampFloatRect({
    ...start,
    left: start.left + (to.x - from.x),
    top: start.top + (to.y - from.y),
  }, viewport)
}

export function applyCornerResize(
  start: FloatRect,
  handle: ResizeHandle,
  from: FloatPoint,
  to: FloatPoint,
  viewport: FloatViewport,
): FloatRect {
  const dx = to.x - from.x
  const dy = to.y - from.y
  let left = start.left
  let top = start.top
  let width = start.width
  let height = start.height
  if (handle === 'bottom-right') {
    width += dx
    height += dy
  } else if (handle === 'bottom-left') {
    left += dx
    width -= dx
    height += dy
  } else if (handle === 'top-right') {
    top += dy
    width += dx
    height -= dy
  } else {
    left += dx
    top += dy
    width -= dx
    height -= dy
  }
  return clampFloatRect({ left, top, width, height }, viewport)
}

export function clampFloatRect(rect: FloatRect, viewport: FloatViewport): FloatRect {
  const width = Math.min(viewport.width, Math.max(MIN_FLOAT_WIDTH, Math.round(rect.width)))
  const height = Math.min(viewport.height, Math.max(MIN_FLOAT_HEIGHT, Math.round(rect.height)))
  const left = Math.min(Math.max(0, Math.round(rect.left)), Math.max(0, viewport.width - width))
  const top = Math.min(Math.max(0, Math.round(rect.top)), Math.max(0, viewport.height - height))
  return { left, top, width, height }
}

export async function persistFloatRect(store: FloatPersist, rect: FloatRect): Promise<void> {
  await store.set(STAGE_FLOAT_LEFT_FIELD, rect.left)
  await store.set(STAGE_FLOAT_TOP_FIELD, rect.top)
  await store.set(STAGE_FLOAT_WIDTH_FIELD, rect.width)
  await store.set(STAGE_FLOAT_HEIGHT_FIELD, rect.height)
}

export async function persistFloatHidden(store: FloatPersist, hidden: boolean): Promise<void> {
  await store.set(STAGE_FLOAT_HIDDEN_FIELD, hidden)
}

export async function persistFloatMuted(
  store: FloatPersist,
  muted: boolean,
  playback?: { set(field: string, value: unknown): Promise<void> },
): Promise<void> {
  if (playback !== undefined) {
    await playback.set('muted', muted)
  }
  await store.set(STAGE_FLOAT_MUTED_FIELD, muted)
}

export const FRIEND_MUTE_EVENT = 'dsh-friend:mute' as const
export const FRIEND_UNMUTE_EVENT = 'dsh-friend:unmute' as const
export const FRIEND_PLAYBACK_GLOBAL = '__DSH_FRIEND_PLAYBACK__' as const
export const FRIEND_TTS_CLIENT_GLOBAL = '__DSH_FRIEND_TTS__' as const
export const FRIEND_TTS_STOP_ALL_GLOBAL = '__dshFriendStopAllTts__' as const

export type LiveMuteTarget = {
  speechSynthesis?: { cancel(): void }
  document?: {
    querySelectorAll(selector: string): ArrayLike<{ pause?: () => void; muted?: boolean }>
  }
} & Record<string, unknown>

/**
 * Stop both playback paths immediately. AudioContext is owned by the TTS
 * client (`stopAll`); speechSynthesis and media elements are cancelled here
 * so tray / float mute is not a no-op when Friend is speaking.
 */
export function applyLiveMute(muted: boolean, target: LiveMuteTarget = globalThis as LiveMuteTarget): void {
  if (muted) {
    const tts = target[FRIEND_TTS_CLIENT_GLOBAL]
    if (isPlaybackHandle(tts)) {
      tts.stopAll()
    }
    const stopAll = target[FRIEND_TTS_STOP_ALL_GLOBAL]
    if (typeof stopAll === 'function') {
      stopAll()
    }
    target.speechSynthesis?.cancel()
  }
  const media = target.document?.querySelectorAll('audio, video')
  if (media === undefined) {
    return
  }
  for (let index = 0; index < media.length; index += 1) {
    const element = media[index]
    if (element === undefined) {
      continue
    }
    if (muted) {
      element.pause?.()
      element.muted = true
    } else {
      element.muted = false
    }
  }
}

function isPlaybackHandle(value: unknown): value is { stopAll(): void } {
  return value !== null && typeof value === 'object' && typeof (value as { stopAll?: unknown }).stopAll === 'function'
}

export function settingsFromUnknown(value: unknown): StageUiSettings {
  return readStageUiSettings(value)
}

function rectForCorner(corner: FloatCorner, width: number, height: number, viewport: FloatViewport): FloatRect {
  const margin = 12
  if (corner === 'bottom-right') {
    return { left: viewport.width - width - margin, top: viewport.height - height - margin, width, height }
  }
  if (corner === 'bottom-left') {
    return { left: margin, top: viewport.height - height - margin, width, height }
  }
  if (corner === 'top-right') {
    return { left: viewport.width - width - margin, top: margin, width, height }
  }
  return { left: margin, top: margin, width, height }
}
