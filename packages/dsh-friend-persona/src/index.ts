import {
  bindHostSettings,
  FRIEND_SETTINGS_NAMESPACES,
  registerFriendSettings,
  type FriendAgentRegistry,
  type FriendPresetContext,
  type FriendPromptContext,
  type FriendToolContext,
  logPluginMount,
} from '@wish233/dsh-friend-shared'

import {
  resolveDshHome,
  type FriendDataDirEnv,
  type ResolveFriendDataDirOptions,
} from './paths.ts'
import {
  assertFriendPresets,
  publishShippedPresets,
  restrictCompanionTools,
  type CompanionAllowlistKind,
} from './presets.ts'
import {
  registerPersonaSections,
  resolveCurrentPersonaSlug,
} from './sections.ts'
import {
  createCompanionReplyHub,
  createCompanionSessionFilter,
  getSharedCompanionReplyHub,
  wrapContextSessionEvents,
  type CompanionReplyHub,
  type FriendSessionEventContext,
} from './companion-reply.ts'
import {
  createSettingsSessionIdStore,
  type CompanionSessionDeps,
} from './session.ts'
import {
  createFriendPersonaSettingsSchema,
  DEFAULT_PERSONA_SETTINGS_ENTRY,
} from './settings-schema.ts'
import { createPersonaStore, type PersonaStore } from './store.ts'

export const name = '@wish233/dsh-friend-persona'

/**
 * Cordis service names this plugin reads. Accessing `ctx.agentPresets`
 * (or `systemPrompt` / `tools` / `agents` / `settings`) without inject throws
 * `cannot get property "…" without inject` and takes down the host tree.
 */
export const inject = ['agentPresets', 'systemPrompt', 'tools', 'agents', 'settings'] as const

export {
  COMPANION_HOST_TOOLS,
  COMPANION_TOOL_ALLOWLIST,
  FRIEND_PRESET_DIRECTORY_IDS,
  MEMORY_TOOLS,
  PLUS_EXTRA_TOOLS,
  PLUS_TOOL_ALLOWLIST,
  PRESET_READY_LOG_EVENT,
  STAGE_TOOLS,
  allowlistFor,
  assertFriendPresets,
  formatPresetReadyLog,
  publishShippedPresets,
  resolveShippedPresetsRoot,
  restrictCompanionTools,
  type CompanionAllowlistKind,
} from './presets.ts'
export {
  CONDUCT_SECTION_NAME,
  CONDUCT_SECTION_ORDER,
  CURRENT_PERSONA_SLUG_FIELD,
  EXPRESSION_VOCABULARY,
  PERSONA_SECTION_NAME,
  PERSONA_SECTION_ORDER,
  formatConductSection,
  formatPersonaSection,
  registerPersonaSections,
  renderConductSectionText,
  renderPersonaSectionText,
  resolveCurrentPersonaSlug,
} from './sections.ts'
export {
  COMPANION_SESSION_ID_FIELD,
  createMemorySessionIdStore,
  createSettingsSessionIdStore,
  getOrCreateCompanionSession,
  sendToCompanion,
} from './session.ts'
export {
  SESSION_EVENT_NAME,
  createCompanionReplyHub,
  createCompanionSessionFilter,
  extractSessionIdentity,
  getSharedCompanionReplyHub,
  inspectSessionEvent,
  isCompanionPresetId,
  normalizeSessionEventArgs,
  resetSharedCompanionReplyHub,
  subscribeCompanionReplies,
  wrapContextSessionEvents,
  type CompanionReplyDelta,
  type CompanionReplyHub,
  type CompanionReplyListener,
  type CompanionSessionFilter,
  type CompanionSessionInfo,
  type FriendSessionEventContext,
  type InspectedSessionEvent,
  type SessionEventSource,
  type SubscribeCompanionRepliesOptions,
} from './companion-reply.ts'
export {
  DEFAULT_PERSONA,
  DEFAULT_PERSONA_SLUG,
  PersonaStore,
  PersonaValidationError,
  createPersonaStore,
} from './store.ts'

/**
 * Minimal host / standing-mount surface this package actually touches.
 *
 * A real dsh `Context` structurally satisfies this. Feature code never
 * names the full Cordis Context or uses `any` / `@ts-ignore`.
 *
 * Same style as shared `FriendRouteContext`: only the methods we call.
 */
export interface FriendPersonaContext {
  /**
   * Bind a disposer to the calling plugin fiber. Host-side IO and
   * registrations happen inside `apply()`, never at module load.
   */
  effect?(
    execute: () => (() => void | Promise<void>),
    label?: string,
  ): () => void | Promise<void>
  agentPresets?: FriendPresetContext['agentPresets']
  systemPrompt?: FriendPromptContext['systemPrompt']
  tools?: FriendToolContext['tools']
  agents?: FriendAgentRegistry
  settings?: {
    get(namespace: string): unknown
    update(namespace: string, patch: Record<string, unknown>): Promise<void>
  }
  /**
   * Cordis `Context.on`. Not a service — do not add it to `inject`.
   * Official: `ctx.on('session/event', …)` (`@deepseek-ai/dsh-session`).
   */
  on?: FriendSessionEventContext['on']
}

/**
 * Cordis plugin config (from `agent.cordis.yml`) plus test seams.
 *
 * `role` defaults to `host`. The companion standing mount MUST pass
 * `role: companion-preset` so sections / restrict never run globally.
 */
export interface PersonaApplyOptions extends ResolveFriendDataDirOptions {
  role?: 'host' | 'companion-preset'
  allowlist?: CompanionAllowlistKind
  /** Test seam: already-resolved friend data root. */
  dataDir?: string
  env?: FriendDataDirEnv
}

export interface PersonaApplyHandle {
  dispose: () => void
  store: PersonaStore
  sessionDeps: CompanionSessionDeps | undefined
  role: 'host' | 'companion-preset'
  /** Host-side companion-reply hub. Tests can `notify` / `attachSource`. */
  replies: CompanionReplyHub
}

/**
 * Host + companion-preset entry.
 *
 * Host (aggregate patch, no config): seed the default card, publish preset
 * directories into `<dshHome>/.agent-presets/` (Plan B), fail-loud if
 * `resolve(id)` is missing or broken, wire session deps. Does **not**
 * register prompt sections or call `restrictTools`.
 *
 * Companion standing mount (`role: companion-preset` in agent.cordis.yml):
 * register `friend:persona` / `friend:conduct` and restrict the allowlist.
 */
export async function apply(
  ctx: FriendPersonaContext,
  config: PersonaApplyOptions = {},
): Promise<() => void> {
  const handle = await applyPersona(ctx, config)
  return handle.dispose
}

export async function applyPersona(
  ctx: FriendPersonaContext,
  config: PersonaApplyOptions = {},
): Promise<PersonaApplyHandle> {
  const role = config.role ?? 'host'
  logPluginMount(name)
  console.info(`[${name}] apply() role=${role}`)

  const pathOptions: ResolveFriendDataDirOptions = {
    ...(config.dataDir !== undefined || config.override !== undefined
      ? { override: config.dataDir ?? config.override }
      : {}),
    ...(config.dshHome !== undefined ? { dshHome: config.dshHome } : {}),
    ...(config.env !== undefined ? { env: config.env } : {}),
    ...(config.homedir !== undefined ? { homedir: config.homedir } : {}),
  }
  const store = createPersonaStore(pathOptions)
  const disposers: Array<() => void> = []

  if (role === 'companion-preset') {
    const companion = applyCompanionPreset(ctx, store, config.allowlist ?? 'companion')
    disposers.push(companion)
    // Official section()/restrict() already bind the fiber. This extra
    // effect is the apply()-level disposer cordis ignores as a return value.
    ctx.effect?.(() => companion, 'dsh-friend-persona:companion-preset')
  } else {
    registerFriendSettings(
      ctx,
      FRIEND_SETTINGS_NAMESPACES.persona,
      createFriendPersonaSettingsSchema(),
      DEFAULT_PERSONA_SETTINGS_ENTRY,
    )
    await applyHost(ctx, store, pathOptions)
  }

  const sessionDeps = bindSessionDeps(ctx)
  const replies = bindReplyHub(ctx, role, disposers)
  const dispose = () => {
    for (const closer of disposers.splice(0).reverse()) {
      closer()
    }
  }

  return { dispose, store, sessionDeps, role, replies }
}

function bindReplyHub(
  ctx: FriendPersonaContext,
  role: 'host' | 'companion-preset',
  disposers: Array<() => void>,
): CompanionReplyHub {
  const hub = role === 'host' ? getSharedCompanionReplyHub() : createCompanionReplyHub()
  if (role !== 'host') {
    return hub
  }
  const source = wrapContextSessionEvents(ctx)
  if (source === undefined) {
    return hub
  }
  const settings = ctx.settings
  const stop = hub.attachSource(source, {
    filter: createCompanionSessionFilter({
      getStandingSessionId: () => {
        if (settings === undefined) {
          return undefined
        }
        try {
          return createSettingsSessionIdStore(bindHostSettings(settings)).get()
        } catch {
          return undefined
        }
      },
    }),
  })
  disposers.push(stop)
  ctx.effect?.(() => stop, 'dsh-friend-persona: companion-reply')
  return hub
}

async function applyHost(
  ctx: FriendPersonaContext,
  store: PersonaStore,
  pathOptions: ResolveFriendDataDirOptions,
): Promise<void> {
  await store.seedDefault()

  const dshHome = resolveDshHome(pathOptions)
  const published = await publishShippedPresets({ dshHome })

  if (ctx.agentPresets === undefined) {
    console.warn(
      `[${name}] ctx.agentPresets missing; published presets to ${published.destRoot} but could not assert resolve()`,
    )
    return
  }

  await assertFriendPresets({ agentPresets: ctx.agentPresets }, published.destRoot)
}

function applyCompanionPreset(
  ctx: FriendPersonaContext,
  store: PersonaStore,
  allowlist: CompanionAllowlistKind,
): () => void {
  if (ctx.systemPrompt === undefined) {
    throw new Error(
      'dsh-friend: companion-preset apply() needs ctx.systemPrompt (register sections on the standing mount, not the host)',
    )
  }
  if (ctx.tools === undefined) {
    throw new Error(
      'dsh-friend: companion-preset apply() needs ctx.tools (restrictTools requires a scoped ctx)',
    )
  }

  const source = {
    dataDir: store.dataDir,
    getCurrentSlug: () => resolveCurrentPersonaSlug(ctx.settings),
  }
  const disposeSections = registerPersonaSections(
    { systemPrompt: ctx.systemPrompt },
    source,
  )
  const disposeRestrict = restrictCompanionTools(
    { tools: ctx.tools },
    allowlist,
  )
  return () => {
    disposeRestrict()
    disposeSections()
  }
}

function bindSessionDeps(ctx: FriendPersonaContext): CompanionSessionDeps | undefined {
  const agents = ctx.agents
  if (agents === undefined) {
    return undefined
  }
  const settings = ctx.settings
  return {
    registry: agents,
    store: settings === undefined
      ? {
          get: () => undefined,
          set: () => undefined,
        }
      : createSettingsSessionIdStore(bindHostSettings(settings)),
  }
}

export { resolveFriendDataDir } from './paths.ts'
