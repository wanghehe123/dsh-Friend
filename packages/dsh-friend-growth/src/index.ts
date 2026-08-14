import {
  FRIEND_SETTINGS_NAMESPACES,
  buildFriendGenerateOptions,
  completeViaLlmStream,
  logPluginMount,
  readDefaultModelSelection,
  registerFriendSettings,
  requireLlmRoute,
  requireLlmRuntime,
  resolveFriendDataDir,
  type FriendDefaultModelContext,
  type FriendLlmRuntime,
  type FriendRouteContext,
  type ResolveFriendDataDirOptions,
  type ResolveModelDeps,
} from '@wishp3/dsh-friend-shared'

import { commitGrowthDraft } from './commit.ts'
import { createGrowthLlm, type CompleteGrowthPrompt, type GrowthLlm } from './llm.ts'
import { runGrowthGeneration } from './pipeline.ts'
import { createGrowthProgressTracker, type GrowthProgressTracker } from './progress.ts'
import { registerGrowthRoutes } from './routes.ts'
import {
  resolveCurrentCharacterSlug,
  resolveGrowthSettings,
  type GrowthSettings,
  type SettingsReader,
} from './settings.ts'
import {
  createFriendGrowthSettingsSchema,
  DEFAULT_GROWTH_SETTINGS_ENTRY,
} from './settings-schema.ts'
import { GrowthStore } from './store.ts'

export const name = '@wishp3/dsh-friend-growth'

/**
 * Cordis services this plugin may read. Accessing `ctx.webServer` /
 * `ctx.settings` / `ctx.agentDefaultModel` / `ctx.llm` without the matching
 * inject throws and takes down the host tree.
 */
export const inject = ['webServer', 'settings', 'agentDefaultModel', 'llm'] as const

export type GrowthApplyRole = 'host' | 'companion-preset'

export interface FriendGrowthContext {
  effect?(
    execute: () => (() => void | Promise<void>),
    label?: string,
  ): () => void | Promise<void>
  webServer?: FriendRouteContext['webServer']
  settings?: SettingsReader
  agentDefaultModel?: FriendDefaultModelContext['agentDefaultModel']
  llm?: FriendLlmRuntime
}

export interface GrowthApplyOptions extends ResolveFriendDataDirOptions {
  role?: GrowthApplyRole
  dataDir?: string
  slug?: string
  completePrompt?: CompleteGrowthPrompt
}

export interface GrowthApplyHandle {
  dispose: () => void
  store: GrowthStore
  role: GrowthApplyRole
  progress: GrowthProgressTracker
  generate: typeof runGrowthGeneration
  commit: typeof commitGrowthDraft
}

export function apply(ctx: FriendGrowthContext, config: GrowthApplyOptions = {}): () => void {
  return applyGrowth(ctx, config).dispose
}

export function applyGrowth(
  ctx: FriendGrowthContext,
  config: GrowthApplyOptions = {},
): GrowthApplyHandle {
  const role = config.role ?? 'host'
  logPluginMount(name)
  console.info(`[${name}] apply() role=${role}`)

  const dataDir = config.dataDir ?? resolveFriendDataDir({
    ...(config.override !== undefined ? { override: config.override } : {}),
    ...(config.dshHome !== undefined ? { dshHome: config.dshHome } : {}),
    ...(config.env !== undefined ? { env: config.env } : {}),
    ...(config.homedir !== undefined ? { homedir: config.homedir } : {}),
  })
  const settings = ctx.settings
  if (role === 'host') {
    registerFriendSettings(
      ctx,
      FRIEND_SETTINGS_NAMESPACES.growth,
      createFriendGrowthSettingsSchema(),
      DEFAULT_GROWTH_SETTINGS_ENTRY,
    )
  }
  const readSettings = (): GrowthSettings => resolveGrowthSettings(settings)
  // Host consumers have no subscribe for other namespaces (see settings-host
  // compat). Re-read `friend-persona.currentSlug` on every store I/O so a
  // config-center switch cannot keep writing the previous character directory.
  const readSlug = (): string => config.slug ?? resolveCurrentCharacterSlug(settings)
  const store = new GrowthStore({ dataDir, slug: readSlug })
  const progress = createGrowthProgressTracker()

  if (role === 'companion-preset') {
    return {
      dispose: () => undefined,
      store,
      role,
      progress,
      generate: runGrowthGeneration,
      commit: commitGrowthDraft,
    }
  }

  const llm = createHostLlm(ctx, config.completePrompt)
  const disposers: Array<() => void> = []

  if (ctx.webServer !== undefined && ctx.effect !== undefined) {
    registerGrowthRoutes(
      { webServer: ctx.webServer, effect: ctx.effect },
      { store, llm, settings: readSettings, progress },
    )
  } else {
    console.warn(`[${name}] ctx.webServer/effect missing; growth routes not mounted`)
  }

  return {
    dispose: () => {
      for (const closer of disposers.splice(0).reverse()) {
        closer()
      }
    },
    store,
    role,
    progress,
    generate: runGrowthGeneration,
    commit: commitGrowthDraft,
  }
}

function createHostLlm(ctx: FriendGrowthContext, complete?: CompleteGrowthPrompt): GrowthLlm {
  const completePrompt: CompleteGrowthPrompt = complete ?? createLiveGrowthComplete(ctx)
  const llm = ctx.llm
  const resolveDeps: ResolveModelDeps = {
    getDefaultModel: () => {
      const agentDefaultModel = ctx.agentDefaultModel
      if (agentDefaultModel === undefined) {
        return { provider: 'default', model: 'default' }
      }
      return readDefaultModelSelection({ agentDefaultModel })
    },
    getSettings: (namespace) => {
      const settings = ctx.settings
      if (settings === undefined) {
        return undefined
      }
      return settings.get(namespace)
    },
    ...(llm !== undefined ? { catalog: llm } : {}),
  }
  return createGrowthLlm({ resolveDeps, complete: completePrompt })
}

/**
 * Production default: one-shot completion through `ctx.llm.stream()`.
 * Tests may still inject `completePrompt`; that seam is no longer the default.
 */
function createLiveGrowthComplete(ctx: FriendGrowthContext): CompleteGrowthPrompt {
  return async (input) => {
    const llm = requireLlmRuntime(ctx.llm, name)
    const route = requireLlmRoute(input.model, name)
    return completeViaLlmStream(llm, buildFriendGenerateOptions({
      route,
      system: input.system,
      user: input.user,
      temperature: input.temperature,
    }))
  }
}

export { FRIEND_SETTINGS_NAMESPACES }
export { resolveFriendDataDir }
export {
  composeMemoryContent,
  occurredAtUnix,
  assignSortOrder,
  parseOutlineResponse,
  parseExpandResponse,
  parseReflectResponse,
  batchRanges,
  normalizeOutline,
  DEFAULT_EPISODE_IMPORTANCE,
  MIN_REFLECTION_IMPORTANCE,
} from './pure.ts'
export { runGrowthGeneration, newBatchId } from './pipeline.ts'
export { commitGrowthDraft, renderStoryMarkdown, renderBeliefsMarkdown } from './commit.ts'
export { selectedBeats, toggleExcluded, renderProgressLabel } from './ui-state.ts'
export { createGrowthRoutes } from './routes.ts'
export { GrowthStore } from './store.ts'
export { createGrowthProgressTracker, IDLE_GROWTH_PROGRESS } from './progress.ts'
export { resolveGrowthSettings, resolveCurrentCharacterSlug, GROWTH_SETTINGS_NAMESPACE } from './settings.ts'
export { renderGrowthPage } from './ui-page.ts'
