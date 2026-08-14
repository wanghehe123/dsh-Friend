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
}

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
      if (live !== undefined) {
        return { id: live.id, agent: live }
      }
      const resumed = await resumeAgent(deps.registry, existingId)
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
    warn(`dsh-friend: getOrCreateCompanionSession failed (${cause(error)})`)
    return { id: '', agent: undefined }
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
): Promise<{ sessionId: string; sent: boolean }> {
  const warn = deps.warn ?? defaultWarn
  try {
    const first = await getOrCreateCompanionSession(deps)
    if (first.agent === undefined) {
      return { sessionId: first.id, sent: false }
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
        return { sessionId: rebuilt.id, sent: false }
      }
      followupText(rebuilt.agent, text)
      return { sessionId: rebuilt.id, sent: true }
    }
  } catch (error) {
    warn(`dsh-friend: sendToCompanion failed (${cause(error)})`)
    return { sessionId: '', sent: false }
  }
}

async function createCompanion(
  deps: CompanionSessionDeps,
  warn: (message: string) => void,
): Promise<CompanionSessionHandle> {
  const sessionId = `friend-companion-${crypto.randomUUID()}`
  const options: FriendCreateAgentOptions = {
    sessionId,
    meta: {
      agentPreset: deps.presetId ?? FRIEND_PRESET_IDS.companion,
      cwd: deps.cwd ?? process.cwd(),
    },
  }
  const agent = await createAgent(deps.registry, options)
  await persistId(deps.store, agent.id, warn)
  return { id: agent.id, agent }
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
