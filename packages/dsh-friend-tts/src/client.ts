/**
 * Client half. Must stay free of `node:` and `@wishp3/dsh-friend-shared`
 * (host). Namespace constants come from `/universal`.
 */
import { FRIEND_SETTINGS_NAMESPACES } from '@wishp3/dsh-friend-shared/universal'

import {
  attachTtsPlayback,
  type AttachTtsPlaybackOptions,
  type FriendTtsPlaybackHandle,
} from './playback-client.ts'
import {
  bindTtsSettings,
  readTtsPlayback,
  type TtsSettingsBinder,
} from './settings.ts'
import {
  startTtsClient as startTtsRuntime,
  type CreateSpeechFallbackExecutorOptions,
  type FriendTtsClientRuntime,
} from './speech-fallback.ts'

export const name = '@wishp3/dsh-friend-tts/client'
export const inject = ['settingsScope'] as const
export const FRIEND_TTS_CLIENT_GLOBAL = '__DSH_FRIEND_TTS__' as const

export type FriendTtsClientContext = {
  effect?(execute: () => () => void, label?: string): void
  settingsScope?: TtsSettingsBinder
}

export type FriendTtsClientHandle = FriendTtsPlaybackHandle

export type StartTtsClientOptions = CreateSpeechFallbackExecutorOptions & AttachTtsPlaybackOptions & {
  settingsScope?: TtsSettingsBinder
}

export type FriendTtsClientGlobal = {
  preview: (text?: string) => Promise<unknown>
  stopAll: () => void
}

/**
 * Apply a live client snapshot onto both playback paths
 * (`speechSynthesis` + AudioContext) and the `autoSpeak` gate.
 */
export function applyTtsPlaybackSettings(
  handle: FriendTtsClientRuntime,
  snapshot: Parameters<typeof readTtsPlayback>[0],
): void {
  const live = readTtsPlayback(snapshot)
  handle.setVolume(live.volume)
  handle.setMuted(live.muted)
  handle.setAutoSpeak(live.autoSpeak)
}

function attachTtsSettings(
  handle: FriendTtsClientRuntime,
  settingsScope: TtsSettingsBinder | undefined,
): FriendTtsClientRuntime {
  if (settingsScope === undefined) {
    return handle
  }
  const scope = bindTtsSettings(settingsScope)
  const applyLive = (): void => {
    applyTtsPlaybackSettings(handle, scope.getSnapshot().value)
  }
  applyLive()
  const unsubscribe = scope.subscribe(applyLive)
  const innerDispose = handle.dispose.bind(handle)
  handle.dispose = () => {
    unsubscribe()
    innerDispose()
  }
  return handle
}

export function startTtsClient(options: StartTtsClientOptions = {}): FriendTtsPlaybackHandle {
  const handle = startTtsRuntime({
    ...(options.speechSynthesis !== undefined ? { speechSynthesis: options.speechSynthesis } : {}),
    ...(options.createUtterance !== undefined ? { createUtterance: options.createUtterance } : {}),
    ...(options.onUiHint !== undefined ? { onUiHint: options.onUiHint } : {}),
    ...(options.onBoundary !== undefined ? { onBoundary: options.onBoundary } : {}),
    ...(options.onSpeakStart !== undefined ? { onSpeakStart: options.onSpeakStart } : {}),
    ...(options.onSpeakEnd !== undefined ? { onSpeakEnd: options.onSpeakEnd } : {}),
    ...(options.player !== undefined ? { player: options.player } : {}),
    ...(options.volume !== undefined ? { volume: options.volume } : {}),
    ...(options.muted !== undefined ? { muted: options.muted } : {}),
    ...(options.autoSpeak !== undefined ? { autoSpeak: options.autoSpeak } : {}),
  })
  const withSettings = attachTtsSettings(handle, options.settingsScope)
  const playback = attachTtsPlayback(withSettings, {
    ...(options.EventSource !== undefined ? { EventSource: options.EventSource } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    ...(options.eventsUrl !== undefined ? { eventsUrl: options.eventsUrl } : {}),
    ...(options.previewUrl !== undefined ? { previewUrl: options.previewUrl } : {}),
  })
  return installTtsClientGlobal(playback)
}

export function apply(ctx: FriendTtsClientContext = {}): FriendTtsClientHandle {
  const handle = startTtsClient({
    ...(ctx.settingsScope !== undefined ? { settingsScope: ctx.settingsScope } : {}),
  })
  if (ctx.effect !== undefined) {
    ctx.effect(() => () => handle.dispose(), 'dsh-friend-tts:client')
    return handle
  }
  console.info(`[${name}] apply()`)
  return handle
}

function installTtsClientGlobal(handle: FriendTtsPlaybackHandle): FriendTtsPlaybackHandle {
  const target = globalThis as typeof globalThis & {
    [FRIEND_TTS_CLIENT_GLOBAL]?: FriendTtsClientGlobal
  }
  const api: FriendTtsClientGlobal = {
    preview: (text) => handle.preview(text),
    stopAll: () => {
      handle.stopAll()
    },
  }
  target[FRIEND_TTS_CLIENT_GLOBAL] = api
  const innerDispose = handle.dispose.bind(handle)
  handle.dispose = () => {
    if (target[FRIEND_TTS_CLIENT_GLOBAL] === api) {
      delete target[FRIEND_TTS_CLIENT_GLOBAL]
    }
    innerDispose()
  }
  return handle
}

export {
  FRIEND_TTS_FALLBACK_UI_HINT,
  FRIEND_TTS_FALLBACK_UI_LABEL,
  createPlainUtterance,
  createSpeechFallbackExecutor,
  fallbackUiLabel,
  getFriendTtsClient,
  mapPitchToSpeech,
  mapRateToSpeech,
  pickSpeechVoice,
  stopAllFriendTts,
  type FriendTtsClientRuntime,
  type FriendTtsSpeechFallbackHandle,
  type FriendTtsStopAll,
  type FriendTtsUiHint,
  type SpeechBoundaryEventLike,
  type SpeechFallbackSpeakRequest,
  type SpeechSynthesisLike,
  type SpeechSynthesisUtteranceFactory,
  type SpeechSynthesisUtteranceLike,
  type SpeechSynthesisVoiceLike,
} from './speech-fallback.ts'

export {
  FRIEND_TTS_ENERGY_HZ,
  createFriendTtsPlayer,
  detectAudioContainer,
  repairWavHeaders,
  rmsFromTimeDomain,
  sineTimeDomainBytes,
  type FriendTtsPlayer,
} from './audio-player.ts'

export {
  FRIEND_TTS_STOP_ALL_GLOBAL,
  installFriendTtsStopAllGlobal,
  registerFriendTtsStop,
} from './stop-all.ts'

export { FRIEND_TTS_PREVIEW_SENTENCE } from './preview-sentence.ts'

export {
  FRIEND_LIPSYNC_EVENT,
  FRIEND_LIPSYNC_LOG_GLOBAL,
  dispatchFriendLipsync,
} from './lipsync.ts'

export {
  FRIEND_FALLBACK_LIPSYNC_BOUNDARY,
  FRIEND_FALLBACK_LIPSYNC_HZ,
  FRIEND_FALLBACK_LIPSYNC_PULSE,
  createFallbackLipsyncDriver,
} from './fallback-lipsync.ts'

export {
  attachTtsPlayback,
  type AttachTtsPlaybackOptions,
  type FriendTtsPlaybackHandle,
} from './playback-client.ts'

export {
  createTtsRequestId,
  isTtsReadyPayload,
  parseTtsReadyFrame,
  type FriendTtsReadyEvent,
  type FriendTtsReadyPayload,
} from './playback-events.ts'

export { FRIEND_TTS_AUDIO_PATH, FRIEND_TTS_EVENTS_PATH, FRIEND_TTS_PREVIEW_PATH } from './paths.ts'

export {
  TTS_AUTO_SPEAK_FIELD,
  TTS_MUTED_FIELD,
  TTS_STRIP_STAGE_FIELD,
  TTS_VOLUME_FIELD,
  createTtsSettingsForm,
  draftFromTtsSnapshot,
  type TtsSettingsDraft,
  type TtsSettingsForm,
} from './settings-form.ts'

export { listCatalogVoices } from './voices.ts'

export {
  FRIEND_TTS_SECRET_FIELDS,
  TTS_SETTINGS_NAMESPACE,
  bindTtsSettings,
  readTtsPlayback,
  sanitizeTtsSettingsForClient,
  toClientTtsSnapshot,
  type FriendTtsClientSnapshot,
  type TtsSettingsBinder,
  type TtsSettingsScope,
} from './settings.ts'

export { FRIEND_SETTINGS_NAMESPACES }
