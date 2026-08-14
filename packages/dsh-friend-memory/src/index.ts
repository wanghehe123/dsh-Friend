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
  type FriendPromptContext,
  type FriendRouteContext,
  type FriendToolContext,
  type ResolveFriendDataDirOptions,
  type ResolveModelDeps,
} from '@wishp3/dsh-friend-shared'

import {
  bindTurnEndSource,
  createAutoSummary,
  type AutoSummaryHandle,
  type CompanionTurnEnd,
  type TurnEndSource,
} from './auto-summary.ts'
import { distillMemory, scheduleDistill } from './distill.ts'
import { importKokoro } from './import-kokoro.ts'
import { createMemoryLlm, type CompletePrompt, type MemoryLlm } from './llm.ts'
import { addDays, formatDay } from './paths.ts'
import { createRgRetriever, readBootstrapSync, type MemoryRetriever } from './retriever.ts'
import { registerMemoryRoutes } from './routes.ts'
import { registerMemorySection } from './sections.ts'
import {
  resolveCurrentCharacterSlug,
  resolveMemorySettings,
  type MemorySettings,
  type SettingsReader,
} from './settings.ts'
import {
  createFriendMemorySettingsSchema,
  DEFAULT_MEMORY_SETTINGS_ENTRY,
} from './settings-schema.ts'
import { createMemoryStore, type MemoryStore } from './store.ts'
import { registerMemoryTools } from './tools.ts'
import { wrapHostTurnEndSource, type FriendSessionEventContext } from './turn-end.ts'

export const name = '@wishp3/dsh-friend-memory'

/**
 * Cordis services this plugin may read. Accessing `ctx.webServer` /
 * `ctx.tools` / `ctx.systemPrompt` / `ctx.settings` / `ctx.agentDefaultModel`
 * / `ctx.llm` without the matching inject throws and takes down the host tree.
 * `ctx.on` is a Cordis intrinsic, not a service — do not add it here.
 */
export const inject = ['webServer', 'tools', 'systemPrompt', 'settings', 'agentDefaultModel', 'llm'] as const

export type MemoryApplyRole = 'host' | 'companion-preset'

export interface FriendMemoryContext {
  effect?(
    execute: () => (() => void | Promise<void>),
    label?: string,
  ): () => void | Promise<void>
  webServer?: FriendRouteContext['webServer']
  tools?: FriendToolContext['tools']
  systemPrompt?: FriendPromptContext['systemPrompt']
  settings?: SettingsReader
  agentDefaultModel?: FriendDefaultModelContext['agentDefaultModel']
  llm?: FriendLlmRuntime
  /**
   * Cordis `Context.on`. Not a service — do not add it to `inject`.
   * Official: `ctx.on('session/event', …)` (`@deepseek-ai/dsh-session`).
   */
  on?: FriendSessionEventContext['on']
}

export interface MemoryApplyOptions extends ResolveFriendDataDirOptions {
  role?: MemoryApplyRole
  dataDir?: string
  slug?: string
  now?: () => Date
  completePrompt?: CompletePrompt
  turnEndSource?: TurnEndSource
  retriever?: MemoryRetriever
}

export interface MemoryApplyHandle {
  dispose: () => void
  store: MemoryStore
  retriever: MemoryRetriever
  role: MemoryApplyRole
  notifyTurnEnd: (event: CompanionTurnEnd) => void
  runDistill: () => Promise<unknown>
  autoSummary?: AutoSummaryHandle
}

export async function apply(
  ctx: FriendMemoryContext,
  config: MemoryApplyOptions = {},
): Promise<() => void> {
  const handle = await applyMemory(ctx, config)
  return handle.dispose
}

export async function applyMemory(
  ctx: FriendMemoryContext,
  config: MemoryApplyOptions = {},
): Promise<MemoryApplyHandle> {
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
      FRIEND_SETTINGS_NAMESPACES.memory,
      createFriendMemorySettingsSchema(),
      DEFAULT_MEMORY_SETTINGS_ENTRY,
    )
  }
  // Host consumers have no subscribe for other namespaces. Re-read memory
  // settings and `friend-persona.currentSlug` on every I/O / clock arm.
  const readSettings = (): MemorySettings => resolveMemorySettings(settings)
  const readSlug = (): string => config.slug ?? resolveCurrentCharacterSlug(settings)
  const now = config.now ?? (() => new Date())
  const store = createMemoryStore({
    dataDir,
    slug: readSlug,
    now,
    memoryMaxBytes: () => readSettings().memoryMaxBytes,
  })
  const today = formatDay(now())
  const yesterday = formatDay(addDays(now(), -1))
  const retriever = config.retriever ?? createRgRetriever({
    dataDir,
    get slug() {
      return store.slug
    },
    today,
    yesterday,
  })

  const disposers: Array<() => void> = []

  if (role === 'companion-preset') {
    disposers.push(applyCompanionPreset(ctx, store, retriever, readSettings))
    ctx.effect?.(() => () => {
      for (const closer of disposers.splice(0).reverse()) closer()
    }, 'dsh-friend-memory:companion-preset')
    return {
      dispose: () => {
        for (const closer of disposers.splice(0).reverse()) closer()
      },
      store,
      retriever,
      role,
      notifyTurnEnd: () => undefined,
      runDistill: async () => ({ status: 'skipped', reason: 'companion-preset' }),
    }
  }

  const host = applyHost(ctx, {
    store,
    retriever,
    settings: readSettings,
    now,
    dataDir,
    ...(config.completePrompt !== undefined ? { completePrompt: config.completePrompt } : {}),
    ...(config.turnEndSource !== undefined ? { turnEndSource: config.turnEndSource } : {}),
  })
  disposers.push(host.dispose)
  ctx.effect?.(() => () => {
    for (const closer of disposers.splice(0).reverse()) closer()
  }, 'dsh-friend-memory:host')

  return {
    dispose: () => {
      for (const closer of disposers.splice(0).reverse()) closer()
    },
    store,
    retriever,
    role,
    notifyTurnEnd: host.notifyTurnEnd,
    runDistill: host.runDistill,
    ...(host.autoSummary !== undefined ? { autoSummary: host.autoSummary } : {}),
  }
}

function applyCompanionPreset(
  ctx: FriendMemoryContext,
  store: MemoryStore,
  retriever: MemoryRetriever,
  readSettings: () => MemorySettings,
): () => void {
  if (ctx.tools === undefined) {
    throw new Error(
      'dsh-friend-memory: companion-preset apply() needs ctx.tools (register memory tools on the standing mount, not the host)',
    )
  }
  if (ctx.systemPrompt === undefined) {
    throw new Error(
      'dsh-friend-memory: companion-preset apply() needs ctx.systemPrompt (register the memory section on the standing mount, not the host)',
    )
  }
  const disposeTools = registerMemoryTools({ tools: ctx.tools }, { store, retriever })
  const disposeSection = registerMemorySection(
    { systemPrompt: ctx.systemPrompt },
    {
      load: () => readBootstrapSync({
        dataDir: store.dataDir,
        slug: store.slug,
        today: formatDay(store.now()),
        yesterday: formatDay(addDays(store.now(), -1)),
      }),
      budgetBytes: readSettings().bootstrapBudgetBytes,
    },
  )
  return () => {
    disposeTools()
    disposeSection()
  }
}

function applyHost(
  ctx: FriendMemoryContext,
  options: {
    store: MemoryStore
    retriever: MemoryRetriever
    settings: () => MemorySettings
    now: () => Date
    completePrompt?: CompletePrompt
    turnEndSource?: TurnEndSource
    dataDir: string
  },
): {
  dispose: () => void
  notifyTurnEnd: (event: CompanionTurnEnd) => void
  runDistill: () => Promise<unknown>
  autoSummary?: AutoSummaryHandle
} {
  const disposers: Array<() => void> = []
  const llm = createHostLlm(ctx, options.completePrompt)

  const runDistill = () => distillMemory({
    store: options.store,
    llm,
    settings: options.settings,
    now: options.now,
  })

  if (ctx.webServer !== undefined && ctx.effect !== undefined) {
    registerMemoryRoutes(
      { webServer: ctx.webServer, effect: ctx.effect },
      {
        store: options.store,
        retriever: options.retriever,
        distill: runDistill,
        importKokoro: (from) => importKokoro({ fromDir: from, dataDir: options.dataDir }),
      },
    )
  } else {
    console.warn(`[${name}] ctx.webServer/effect missing; memory browser routes not mounted`)
  }

  void options.store.archiveOldNotes(options.now()).catch((error: unknown) => {
    console.warn(`[${name}] archive failed: ${error instanceof Error ? error.message : String(error)}`)
  })

  const autoSummary = createAutoSummary({
    store: options.store,
    llm,
    settings: options.settings,
    now: options.now,
  })
  disposers.push(() => autoSummary.dispose())
  const turnEndSource = options.turnEndSource ?? wrapHostTurnEndSource(ctx)
  if (turnEndSource !== undefined) {
    disposers.push(bindTurnEndSource(turnEndSource, autoSummary))
  }

  disposers.push(scheduleDistill({
    hour: () => options.settings().distillHour,
    minute: () => options.settings().distillMinute,
    now: options.now,
    run: () => {
      void runDistill()
    },
  }))

  return {
    dispose: () => {
      for (const closer of disposers.splice(0).reverse()) closer()
    },
    notifyTurnEnd: (event) => autoSummary.notify(event),
    runDistill,
    autoSummary,
  }
}

function createHostLlm(ctx: FriendMemoryContext, complete?: CompletePrompt): MemoryLlm {
  const completePrompt: CompletePrompt = complete ?? createLiveMemoryComplete(ctx)
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
  return createMemoryLlm({ resolveDeps, complete: completePrompt })
}

/**
 * Production default: one-shot completion through `ctx.llm.stream()`.
 * Tests may still inject `completePrompt`; that seam is no longer the default.
 */
function createLiveMemoryComplete(ctx: FriendMemoryContext): CompletePrompt {
  return async (input) => {
    const llm = requireLlmRuntime(ctx.llm, name)
    const route = requireLlmRoute(input.model, name)
    return completeViaLlmStream(llm, buildFriendGenerateOptions({
      route,
      system: input.system,
      user: input.user,
    }))
  }
}

export { FRIEND_SETTINGS_NAMESPACES }
export { MEMORY_TOOL_NAMES, createMemoryTools, registerMemoryTools } from './tools.ts'
export { MEMORY_SECTION_NAME, MEMORY_SECTION_ORDER, formatMemorySection, registerMemorySection } from './sections.ts'
export { MemoryStore, createMemoryStore, parseMemoryMarkdown, serializeMemoryMarkdown, MEMORY_SECTION_TITLES } from './store.ts'
export { RgRetriever, FileRetriever, createRgRetriever, buildRgArgs } from './retriever.ts'
export { distillMemory, applyDistillGuards, scheduleDistill, nextDistillAt, DISTILL_CLOCK_WATCH_MS } from './distill.ts'
export { createAutoSummary, summarizeTurn, isCompanionPreset } from './auto-summary.ts'
export { importKokoro } from './import-kokoro.ts'
export { resolveMemorySettings, resolveCurrentCharacterSlug, MEMORY_SETTINGS_NAMESPACE } from './settings.ts'
export { resolveMemoryPath, MemoryPathError } from './whitelist.ts'
export { renderMemoryBrowserPage, renderSearchHits } from './browser-page.ts'
export { createMemoryRoutes } from './routes.ts'
export { resolveFriendDataDir }
