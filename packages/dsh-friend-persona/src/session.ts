import {
  FRIEND_PRESET_IDS,
  FRIEND_SETTINGS_NAMESPACES,
  createAgent,
  followupText,
  getLiveAgent,
  resumeAgent,
  type FriendAgentHandle,
  type FriendAgentRegistry,
  type FriendCreateAgentOptions,
} from '@wish233/dsh-friend-shared'

/** Settings field in `friend-core` that stores the standing companion session id. */
export const COMPANION_SESSION_ID_FIELD = 'companionSessionId' as const

export interface CompanionSessionIdStore {
  get(): string | undefined
  set(id: string): void | Promise<void>
}

export interface CompanionSessionHandle {
  id: string
  agent: FriendAgentHandle | undefined
  error?: string
}

export type CompanionSendResult = Readonly<{
  sessionId: string
  sent: boolean
  error?: string
}>

export interface CompanionSessionDeps {
  /** Official: `ctx.agents` (`@deepseek-ai/dsh-agent`). */
  registry: FriendAgentRegistry
  /**
   * Persists the standing session id. Production uses
   * {@link createSettingsSessionIdStore} (`friend-core.companionSessionId`).
   */
  store: CompanionSessionIdStore
  /** Defaults to `friend-companion`. */
  presetId?: string
  /** Absolute cwd stamped on create; defaults to `process.cwd()`. */
  cwd?: string
  /**
   * Official: `ctx.agentDefaultModel.currentSelection()`.
   * Stamped onto `agentOptions` so `{{model}}` and the LLM route have a value.
   */
  getDefaultModel?: () =>
    | { provider: string; model: string; reasoningEffort?: string }
    | Promise<{ provider: string; model: string; reasoningEffort?: string }>
  /**
   * Official: `ctx.agentPresets.mount(agentCtx, id)`.
   * Header `agentPreset` alone does not join the standing companion scope.
   */
  mountPreset?: (agentCtx: unknown, id: string) => void | Promise<void>
  warn?: (message: string) => void
}

/**
 * Read/write the standing companion session id from the `friend-core` settings
 * namespace.
 *
 * Why settings, not the data directory: the id is a pointer into dsh's own
 * session persistence (`ctx.sessionPersistence`), not Friend file data. WBS
 * W-M1-5 stores it on `friend.core`; rc.6 forbids dotted namespaces, so the
 * field lives at `friend-core` / `companionSessionId`. Large Markdown / assets
 * stay under `~/.dsh/friend/`.
 *
 * Official: `ctx.settings.get(ns)` / `ctx.settings.update(ns, patch)`
 * (`@deepseek-ai/dsh-settings`).
 *
 * Callers must pass the live settings object (or {@link bindHostSettings} of
 * it). Real shape measured on rc.6: `update` calls `this.write`; extracting
 * the method throws `this.write is not a function`.
 */
export function createSettingsSessionIdStore(settings: {
  get(namespace: string): unknown
  update(namespace: string, patch: Record<string, unknown>): Promise<void>
}): CompanionSessionIdStore {
  const namespace = FRIEND_SETTINGS_NAMESPACES.core
  return {
    get(): string | undefined {
      try {
        return readSessionId(settings.get(namespace))
      } catch {
        return undefined
      }
    },
    async set(id: string): Promise<void> {
      await settings.update(namespace, { [COMPANION_SESSION_ID_FIELD]: id })
    },
  }
}

/** In-memory store for tests. */
export function createMemorySessionIdStore(initial?: string): CompanionSessionIdStore {
  let value = initial
  return {
    get(): string | undefined {
      return value
    },
    set(id: string): void {
      value = id
    },
  }
}

/**
 * Return the standing companion agent, creating or resuming it as needed.
 *
 * Official create/resume: `ctx.agents.create` / `ctx.agents.resume`
 * (`@deepseek-ai/dsh-agent`). Live lookup: `ctx.agents.get`.
 *
 * Create/resume must pass `setup` → `agentPresets.mount` and stamp
 * `agentOptions` from the default model. Header `agentPreset` alone leaves
 * the global `deployment:persona` (with `{{model}}`) in place.
 *
 * Missing or invalid ids rebuild a new companion session. Failures are
 * warned, not thrown.
 */
export async function getOrCreateCompanionSession(
  deps: CompanionSessionDeps,
): Promise<CompanionSessionHandle> {
  const warn = deps.warn ?? defaultWarn
  try {
    const existingId = readStoredId(deps.store)
    if (existingId !== undefined) {
      const live = getLiveAgent(deps.registry, existingId)
      if (live !== undefined && liveAgentHasModelRoute(live)) {
        return { id: live.id, agent: live }
      }
      if (live !== undefined) {
        warn(
          `dsh-friend: companion session "${existingId}" is live but has no model route; creating a new one`,
        )
        return await createCompanion(deps, warn)
      }
      const extras = await companionAgentExtras(deps)
      const resumed = await resumeAgent(deps.registry, existingId, extras)
      if (resumed !== undefined) {
        await persistId(deps.store, resumed.id, warn)
        return { id: resumed.id, agent: resumed }
      }
      warn(
        `dsh-friend: companion session "${existingId}" is gone; creating a new one`,
      )
    }

    return await createCompanion(deps, warn)
  } catch (error) {
    const errorText = cause(error)
    warn(`dsh-friend: getOrCreateCompanionSession failed (${errorText})`)
    return { id: '', agent: undefined, error: errorText }
  }
}

/**
 * Send one user text into the standing companion session.
 *
 * Official: `agent.followup(message)` (`@deepseek-ai/dsh-agent`).
 * If the live agent disappears mid-send, the session is rebuilt once.
 * Never throws.
 */
export async function sendToCompanion(
  text: string,
  deps: CompanionSessionDeps,
): Promise<CompanionSendResult> {
  const warn = deps.warn ?? defaultWarn
  try {
    const first = await getOrCreateCompanionSession(deps)
    if (first.agent === undefined) {
      return {
        sessionId: first.id,
        sent: false,
        error: first.error ?? 'Companion session is not available',
      }
    }
    try {
      followupText(first.agent, text)
      return { sessionId: first.id, sent: true }
    } catch (error) {
      warn(
        `dsh-friend: followup failed on "${first.id}" (${cause(error)}); rebuilding companion session`,
      )
      await persistId(deps.store, '', warn)
      const rebuilt = await createCompanion(deps, warn)
      if (rebuilt.agent === undefined) {
        return {
          sessionId: rebuilt.id,
          sent: false,
          error: rebuilt.error ?? cause(error),
        }
      }
      followupText(rebuilt.agent, text)
      return { sessionId: rebuilt.id, sent: true }
    }
  } catch (error) {
    const errorText = cause(error)
    warn(`dsh-friend: sendToCompanion failed (${errorText})`)
    return { sessionId: '', sent: false, error: errorText }
  }
}

async function createCompanion(
  deps: CompanionSessionDeps,
  warn: (message: string) => void,
): Promise<CompanionSessionHandle> {
  const presetId = deps.presetId ?? FRIEND_PRESET_IDS.companion
  const sessionId = `friend-companion-${crypto.randomUUID()}`
  const extras = await companionAgentExtras(deps, presetId)
  const options: FriendCreateAgentOptions = {
    sessionId,
    meta: {
      agentPreset: presetId,
      cwd: deps.cwd ?? process.cwd(),
    },
    ...extras,
  }
  const agent = await createAgent(deps.registry, options)
  await persistId(deps.store, agent.id, warn)
  return { id: agent.id, agent }
}

async function companionAgentExtras(
  deps: CompanionSessionDeps,
  presetId = deps.presetId ?? FRIEND_PRESET_IDS.companion,
): Promise<Pick<FriendCreateAgentOptions, 'agentOptions' | 'setup'>> {
  const route = await resolveCompanionRoute(deps)
  return {
    ...(route === undefined ? {} : { agentOptions: route }),
    ...(deps.mountPreset === undefined
      ? {}
      : {
          setup: async (agentCtx: unknown) => {
            await deps.mountPreset!(agentCtx, presetId)
          },
        }),
  }
}

async function resolveCompanionRoute(
  deps: CompanionSessionDeps,
): Promise<FriendCreateAgentOptions['agentOptions'] | undefined> {
  if (deps.getDefaultModel === undefined) {
    return undefined
  }
  try {
    const selection = await deps.getDefaultModel()
    if (selection.provider.length === 0 || selection.model.length === 0) {
      return undefined
    }
    return {
      provider: selection.provider,
      model: selection.model,
      ...(typeof selection.reasoningEffort === 'string' && selection.reasoningEffort.length > 0
        ? { reasoningEffort: selection.reasoningEffort }
        : {}),
    }
  } catch (error) {
    deps.warn?.(`dsh-friend: failed to read default model for companion (${cause(error)})`)
    return undefined
  }
}

export function liveAgentHasModelRoute(agent: FriendAgentHandle): boolean {
  const provider = agent.options?.provider
  const model = agent.options?.model
  return typeof provider === 'string' && provider.length > 0
    && typeof model === 'string' && model.length > 0
}

function readStoredId(store: CompanionSessionIdStore): string | undefined {
  return normalizeId(store.get())
}

function readSessionId(section: unknown): string | undefined {
  if (section === undefined || section === null) {
    return undefined
  }
  if (typeof section !== 'object' || Array.isArray(section)) {
    return undefined
  }
  const value = (section as Record<string, unknown>)[COMPANION_SESSION_ID_FIELD]
  return normalizeId(typeof value === 'string' ? value : undefined)
}

function normalizeId(id: string | undefined): string | undefined {
  if (id === undefined) {
    return undefined
  }
  const trimmed = id.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

async function persistId(
  store: CompanionSessionIdStore,
  id: string,
  warn: (message: string) => void,
): Promise<void> {
  try {
    await store.set(id)
  } catch (error) {
    warn(`dsh-friend: failed to persist companion session id (${cause(error)})`)
  }
}

function defaultWarn(message: string): void {
  console.warn(message)
}

function cause(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type { FriendAgentHandle, FriendUserMessage } from '@wish233/dsh-friend-shared'
