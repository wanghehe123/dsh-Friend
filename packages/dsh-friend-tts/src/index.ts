import { join } from 'node:path'

import {
  createCompanionSessionFilter,
  createSettingsSessionIdStore,
  subscribeCompanionReplies,
  wrapContextSessionEvents,
  type SessionEventSource,
} from '@wishp3/dsh-friend-persona'
import {
  bindHostSettings,
  FRIEND_SETTINGS_NAMESPACES,
  logPluginMount,
  registerFriendSettings,
  registerRoute,
  resolveFriendDataDir,
  type FriendRouteContext,
} from '@wishp3/dsh-friend-shared'

import { createFriendTtsCache, type FriendTtsCache } from './cache.ts'
import { createDashScopeTtsProvider, type DashScopeProviderOptions } from './providers/dashscope.ts'
import { createEdgeTtsProvider, type EdgeTtsProviderOptions } from './providers/edge.ts'
import { createMiniMaxTtsProvider, type MiniMaxProviderOptions } from './providers/minimax.ts'
import { createOpenAiCompatProvider, type OpenAiCompatProviderOptions } from './providers/openai.ts'
import { createFriendTtsQueue, type FriendTtsQueue } from './queue.ts'
import type { FriendTtsReadySink } from './playback-events.ts'
import { createTtsPreviewRoute } from './preview-route.ts'
import { resolveTtsReadySink } from './push.ts'
import { toTtsReadyEvent } from './ready-event.ts'
import { createTtsAudioRoute } from './routes.ts'
import {
  createFriendTtsRouter,
  readFriendTtsConfig,
  type FriendTtsConfigSource,
  type FriendTtsLog,
  type FriendTtsRouter,
} from './router.ts'
import { createFriendTtsRegistry, FRIEND_TTS_DEFAULT_PROVIDER, type FriendTtsRegistry } from './seam.ts'
import {
  bindServiceSpeakSentence,
  createCompanionTtsSpeaker,
} from './reply-speaker.ts'
import { createFriendTtsService, type FriendTtsService, type FriendTtsSpeakResult } from './service.ts'
import { readFriendTtsHostSettings } from './settings.ts'
import {
  createFriendTtsSettingsSchema,
  DEFAULT_TTS_SETTINGS_ENTRY,
} from './settings-schema.ts'

export const name = '@wishp3/dsh-friend-tts'
/** Cordis forbids reading `ctx.webServer` / `ctx.settings` unless this plugin injects them. */
export const inject = ['webServer', 'settings'] as const

export {
  FRIEND_TTS_BROWSER_PROVIDER,
  FRIEND_TTS_DASHSCOPE_PROVIDER,
  FRIEND_TTS_DEFAULT_PROVIDER,
  FRIEND_TTS_MINIMAX_PROVIDER,
  FRIEND_TTS_OPENAI_COMPAT_PROVIDER,
  createFriendTtsRegistry,
  type FriendTtsAudio,
  type FriendTtsProvider,
  type FriendTtsRegistry,
  type FriendTtsSynthesizeOpts,
  type FriendTtsUnregister,
  type FriendTtsVoice,
  type FriendTtsVoiceGender,
} from './seam.ts'

export {
  createFriendTtsRouter,
  readFriendTtsConfig,
  type FriendTtsAudioResult,
  type FriendTtsBrowserFallback,
  type FriendTtsConfig,
  type FriendTtsConfigSource,
  type FriendTtsFailedProvider,
  type FriendTtsLog,
  type FriendTtsRouteResult,
  type FriendTtsRouter,
} from './router.ts'

export {
  EDGE_BUILTIN_VOICES,
  EDGE_DEFAULT_MIME,
  EDGE_DEFAULT_VOICE,
  EDGE_PROVIDER_ID,
  EDGE_SYNTH_TIMEOUT_MS,
  createDefaultEdgeProvider,
  createEdgeTtsProvider,
  type EdgeTtsProviderOptions,
} from './providers/edge.ts'

export {
  DASHSCOPE_COSYVOICE_PATH,
  DASHSCOPE_DEFAULT_BASE_URL,
  DASHSCOPE_DEFAULT_MODEL,
  DASHSCOPE_DEFAULT_VOICE,
  DASHSCOPE_PROVIDER_ID,
  DASHSCOPE_QWEN_TTS_PATH,
  DASHSCOPE_TIMEOUT_MS,
  DASHSCOPE_VOICES,
  createDashScopeTtsProvider,
  dashscopeSpeechUrl,
  isCosyVoiceModel,
  normalizeDashScopeRoot,
  type DashScopeCredentials,
  type DashScopeProviderOptions,
} from './providers/dashscope.ts'

export {
  MINIMAX_DEFAULT_BASE_URL,
  MINIMAX_DEFAULT_FORMAT,
  MINIMAX_DEFAULT_MODEL,
  MINIMAX_DEFAULT_VOICE,
  MINIMAX_PATH,
  MINIMAX_PROVIDER_ID,
  MINIMAX_TIMEOUT_MS,
  MINIMAX_VOICES,
  createMiniMaxTtsProvider,
  decodeMiniMaxHex,
  mapPitchToMiniMax,
  mapRateToMiniMaxSpeed,
  type MiniMaxCredentials,
  type MiniMaxProviderOptions,
} from './providers/minimax.ts'

export {
  OPENAI_COMPAT_DEFAULT_FORMAT,
  OPENAI_COMPAT_DEFAULT_MODEL,
  OPENAI_COMPAT_DEFAULT_VOICE,
  OPENAI_COMPAT_PATH,
  OPENAI_COMPAT_PROVIDER_ID,
  OPENAI_COMPAT_TIMEOUT_MS,
  OPENAI_COMPAT_VOICES,
  createOpenAiCompatProvider,
  mapRateToSpeed,
  openaiSpeechUrl,
  type OpenAiCompatCredentials,
  type OpenAiCompatProviderOptions,
} from './providers/openai.ts'

export {
  FRIEND_TTS_FALLBACK_ENGINE,
  FRIEND_TTS_FALLBACK_UI_HINT,
  FRIEND_TTS_FALLBACK_UI_LABEL,
  createBrowserFallbackInstruction,
  fallbackUiLabel,
  isBrowserFallback,
  type FriendTtsBrowserFallback as FriendTtsBrowserFallbackInstruction,
} from './providers/browser.ts'

export {
  FRIEND_TTS_CACHE_ID_PATTERN,
  FRIEND_TTS_CACHE_MAX_ENTRIES,
  FRIEND_TTS_CACHE_TTL_MS,
  buildTtsCacheKey,
  createFriendTtsCache,
  isTtsCacheId,
  type CreateFriendTtsCacheOptions,
  type FriendTtsCache,
  type FriendTtsCacheKeyInput,
  type FriendTtsCachedAudio,
} from './cache.ts'

export {
  FRIEND_TTS_DEFAULT_SESSION,
  FRIEND_TTS_QUEUE_CLEARED,
  FRIEND_TTS_QUEUE_CONCURRENCY,
  createFriendTtsQueue,
  type FriendTtsEnqueueOptions,
  type FriendTtsQueue,
  type FriendTtsQueueSize,
  type FriendTtsQueueTask,
} from './queue.ts'

export {
  createFriendTtsService,
  ttsAudioUrl,
  type CreateFriendTtsServiceOptions,
  type FriendTtsService,
  type FriendTtsSpeakAudio,
  type FriendTtsSpeakBatch,
  type FriendTtsSpeakOpts,
  type FriendTtsSpeakResult,
} from './service.ts'

export {
  FRIEND_TTS_PREVIEW_SENTENCE,
  createStreamingTtsPreparer,
  isSpeakableText,
  prepareTtsText,
  splitSentences,
  stripMarkdown,
  stripParentheticalStageDirections,
  stripStageProtocolTags,
  type PreparedTtsText,
  type PrepareTtsTextOptions,
  type StreamingTtsPrepareDelta,
  type StreamingTtsPreparer,
} from './prepare.ts'

export {
  bindServiceSpeakSentence,
  createCompanionTtsSpeaker,
  type CompanionTtsSpeakSentence,
  type CompanionTtsSpeaker,
  type CreateCompanionTtsSpeakerOptions,
} from './reply-speaker.ts'

export { listCatalogVoices } from './voices.ts'

export { FRIEND_TTS_AUDIO_PATH, FRIEND_TTS_EVENTS_PATH, FRIEND_TTS_PREVIEW_PATH } from './paths.ts'

export { createTtsAudioRoute, createTtsRoutes, decodeRequestPath, pathHasTraversal } from './routes.ts'

export { createTtsPreviewRoute } from './preview-route.ts'

export { createFriendTtsEventsHub, resolveTtsReadySink } from './push.ts'

export { toTtsReadyEvent } from './ready-event.ts'

export {
  createTtsRequestId,
  isTtsReadyPayload,
  parseTtsReadyFrame,
  type FriendTtsReadyEvent,
  type FriendTtsReadyPayload,
  type FriendTtsReadySink,
} from './playback-events.ts'

export {
  FRIEND_TTS_SECRET_FIELDS,
  TTS_AUTO_SPEAK_FIELD,
  TTS_MUTED_FIELD,
  TTS_OPENAI_API_KEY_FIELD,
  TTS_OPENAI_BASE_URL_FIELD,
  TTS_OPENAI_FORMAT_FIELD,
  TTS_OPENAI_MODEL_FIELD,
  TTS_PITCH_FIELD,
  TTS_PROVIDER_FIELD,
  TTS_RATE_FIELD,
  TTS_SETTINGS_NAMESPACE,
  TTS_STRIP_STAGE_FIELD,
  TTS_VOICE_FIELD,
  TTS_VOLUME_FIELD,
  bindTtsSettings,
  readFriendTtsHostSettings,
  readTtsPlayback,
  sanitizeTtsSettingsForClient,
  toClientTtsSnapshot,
  type FriendTtsClientSnapshot,
  type FriendTtsHostSettings,
  type FriendTtsSecretField,
  type TtsSettingsBinder,
  type TtsSettingsScope,
} from './settings.ts'

/**
 * Minimal host surface. A real DSH `Context` structurally satisfies this.
 * Runtime `@deepseek-ai/*` imports are forbidden outside `dsh-friend-shared`.
 */
export type FriendTtsApplyContext = {
  effect?: FriendRouteContext['effect']
  settings?: {
    get(namespace: string): unknown
    update?(namespace: string, patch: Record<string, unknown>): Promise<void>
  }
  webServer?: FriendRouteContext['webServer']
  /**
   * Cordis `Context.on`. Not a service — do not add it to `inject`.
   * Official: `ctx.on('session/event', …)` (`@deepseek-ai/dsh-session`).
   */
  on?: (event: string, handler: (...args: unknown[]) => unknown) => unknown
}

export type FriendTtsApplyOptions = {
  replySource?: SessionEventSource
  onSpeak?: (result: FriendTtsSpeakResult) => void
  /**
   * Injected downlink. When omitted, TTS owns `GET /friend/tts/events`.
   * Do not pass shared `pushToClient` — that would collide with stage on
   * `/friend/events`. To multiplex later, inject a sink that forwards
   * `tts-ready` onto the existing stage hub.
   */
  push?: FriendTtsReadySink
  /** Override the on-disk cache root. `null` keeps the cache in memory. */
  cacheDir?: string | null
}

export type FriendTtsHost = {
  registry: FriendTtsRegistry
  router: FriendTtsRouter
  cache: FriendTtsCache
  queue: FriendTtsQueue
  service: FriendTtsService
  speak: FriendTtsService['speak']
  dispose: () => void
}

export type CreateFriendTtsHostOptions = {
  getConfig?: FriendTtsConfigSource
  /** Raw `friend-tts` document (may contain the openai key). Host-only. */
  getHostSettings?: () => unknown
  log?: FriendTtsLog
  edge?: EdgeTtsProviderOptions
  openai?: Omit<OpenAiCompatProviderOptions, 'getCredentials'>
  dashscope?: Omit<DashScopeProviderOptions, 'getCredentials'>
  minimax?: Omit<MiniMaxProviderOptions, 'getCredentials'>
  cacheDir?: string
  now?: () => number
}

/** Wire Edge, openai-compat, DashScope, and MiniMax into the live registry. */
export function createFriendTtsHost(options: CreateFriendTtsHostOptions = {}): FriendTtsHost {
  const registry = createFriendTtsRegistry()
  const getConfig: FriendTtsConfigSource = options.getConfig ?? (() => ({}))
  const readSettings = (): unknown => options.getHostSettings?.()

  const endpointCredentials = () => {
    const host = readFriendTtsHostSettings(readSettings())
    return {
      ...(host.openaiApiKey !== undefined ? { apiKey: host.openaiApiKey } : {}),
      ...(host.openaiBaseURL !== undefined ? { baseURL: host.openaiBaseURL } : {}),
      ...(host.openaiModel !== undefined ? { model: host.openaiModel } : {}),
      ...(host.openaiFormat !== undefined ? { format: host.openaiFormat } : {}),
    }
  }
  const unregisterEdge = registry.register(createEdgeTtsProvider(options.edge))
  const unregisterOpenAi = registry.register(createOpenAiCompatProvider({
    getCredentials: endpointCredentials,
    ...(options.openai ?? {}),
  }))
  const unregisterDashScope = registry.register(createDashScopeTtsProvider({
    getCredentials: endpointCredentials,
    ...(options.dashscope ?? {}),
  }))
  const unregisterMiniMax = registry.register(createMiniMaxTtsProvider({
    getCredentials: endpointCredentials,
    ...(options.minimax ?? {}),
  }))

  const router = createFriendTtsRouter({
    registry,
    getConfig,
    ...(options.log !== undefined ? { log: options.log } : {}),
  })
  const cache = createFriendTtsCache({
    ...(options.cacheDir !== undefined ? { directory: options.cacheDir } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  })
  const queue = createFriendTtsQueue()
  const service = createFriendTtsService({
    router,
    cache,
    queue,
    getPreferredProvider: () => {
      try {
        return getConfig()?.provider?.trim() || FRIEND_TTS_DEFAULT_PROVIDER
      } catch {
        return FRIEND_TTS_DEFAULT_PROVIDER
      }
    },
    getStripStageDirections: () => {
      try {
        return getConfig()?.stripStageDirections !== false
      } catch {
        return true
      }
    },
    getAutoSpeak: () => {
      try {
        return getConfig()?.autoSpeak !== false
      } catch {
        return true
      }
    },
    ...(options.log !== undefined ? { log: options.log } : {}),
  })

  return {
    registry,
    router,
    cache,
    queue,
    service,
    speak: (text, opts) => service.speak(text, opts),
    dispose() {
      queue.dispose()
      cache.dispose()
      unregisterMiniMax()
      unregisterDashScope()
      unregisterOpenAi()
      unregisterEdge()
    },
  }
}

export function apply(ctx: FriendTtsApplyContext = {}, config: FriendTtsApplyOptions = {}): void {
  logPluginMount(name)
  registerFriendSettings(
    ctx,
    FRIEND_SETTINGS_NAMESPACES.tts,
    createFriendTtsSettingsSchema(),
    DEFAULT_TTS_SETTINGS_ENTRY,
  )
  const host = createFriendTtsHost({
    getConfig: () => {
      const settings = ctx.settings
      if (settings === undefined) return undefined
      try {
        return readFriendTtsConfig(settings.get(FRIEND_SETTINGS_NAMESPACES.tts))
      } catch {
        return undefined
      }
    },
    getHostSettings: () => {
      const settings = ctx.settings
      if (settings === undefined) return undefined
      try {
        return settings.get(FRIEND_SETTINGS_NAMESPACES.tts)
      } catch {
        return undefined
      }
    },
    ...(config.cacheDir === null
      ? {}
      : { cacheDir: config.cacheDir ?? join(resolveFriendDataDir(), 'cache', 'tts') }),
  })
  ctx.effect?.(() => () => host.dispose(), 'dsh-friend-tts: providers')

  const routeCtx = asRouteContext(ctx)
  const downlink = resolveTtsReadySink(routeCtx, config.push)
  ctx.effect?.(() => () => downlink.dispose(), 'dsh-friend-tts: downlink')

  if (routeCtx !== undefined) {
    registerRoute(routeCtx, createTtsAudioRoute({
      getAudio: (id) => host.service.getAudio(id),
    }))
    registerRoute(routeCtx, createTtsPreviewRoute({
      speak: (text, opts) => host.service.speak(text, { ...opts, autoSpeak: true }),
      sink: downlink.sink,
    }))
  }

  const notifyReady = (result: FriendTtsSpeakResult, source: 'reply' | 'preview'): void => {
    config.onSpeak?.(result)
    downlink.sink.push(toTtsReadyEvent(result, source))
  }

  const source = config.replySource ?? wrapContextSessionEvents(ctx)
  if (source !== undefined) {
    const speaker = createCompanionTtsSpeaker({
      speakSentence: bindServiceSpeakSentence(host.service, (result) => {
        notifyReady(result, 'reply')
      }),
      getAutoSpeak: () => {
        const settings = ctx.settings
        if (settings === undefined) return true
        try {
          return readFriendTtsConfig(settings.get(FRIEND_SETTINGS_NAMESPACES.tts))?.autoSpeak !== false
        } catch {
          return true
        }
      },
      stripStageDirections: (() => {
        const settings = ctx.settings
        if (settings === undefined) return true
        try {
          return readFriendTtsConfig(settings.get(FRIEND_SETTINGS_NAMESPACES.tts))?.stripStageDirections !== false
        } catch {
          return true
        }
      })(),
    })
    const stop = subscribeCompanionReplies(source, (delta) => speaker.accept(delta), {
      filter: createCompanionSessionFilter({
        getStandingSessionId: () => standingSessionId(ctx),
      }),
    })
    ctx.effect?.(() => () => {
      stop()
      speaker.dispose()
    }, 'dsh-friend-tts: companion-reply')
  }
}

function standingSessionId(ctx: FriendTtsApplyContext): string | undefined {
  const settings = ctx.settings
  if (settings === undefined) {
    return undefined
  }
  try {
    return createSettingsSessionIdStore(bindHostSettings({
      get(namespace) {
        return settings.get(namespace)
      },
      update(namespace, patch) {
        if (settings.update === undefined) {
          return Promise.resolve()
        }
        return settings.update(namespace, patch)
      },
    })).get()
  } catch {
    return undefined
  }
}

function asRouteContext(ctx: FriendTtsApplyContext): FriendRouteContext | undefined {
  if (ctx.webServer === undefined || ctx.effect === undefined) {
    return undefined
  }
  return { webServer: ctx.webServer, effect: ctx.effect }
}
