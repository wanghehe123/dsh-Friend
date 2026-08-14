/**
 * Agent registry and follow-up delivery.
 *
 * Official (`@deepseek-ai/dsh-agent`):
 * - `ctx.agents.create(options)` — create agent + session; `options.sessionId` is required
 * - `ctx.agents.get(id)` — live agent or `undefined`
 * - `ctx.agents.resume({ resumeSessionId })` — load a persisted session after restart
 *
 * Real shape measured on rc.6 (isolated `dsh web`, source: `dsh-friend:shape-diag`):
 * - `create()` / `resume()` return `{ agent, dispose }`, **not** the live agent.
 *   `create()` ownKeys=`["agent","dispose"]`; `followup` is absent on the handle.
 * - `create().agent` and `get(id)` are `ReactLoopAgent` with prototype methods
 *   `followup#1` / `send#3` / `steer#1` / `inject#1` / `cancel#1` / `whenIdle#0`.
 * - `resume()` of a missing id throws `session "…" not found`.
 *
 * Replacement: if `create` / `resume` / `followup` move, only this module
 * changes. Feature packages keep talking to {@link FriendAgentRegistry}.
 */

/** Structural user message accepted by `agent.followup()`. */
export interface FriendUserMessage {
  readonly id: string
  readonly role: 'user'
  readonly content: ReadonlyArray<{ type: 'text'; text: string }>
  readonly source: { readonly kind: 'user' }
}

/**
 * Live agent handle. Official {@link Agent} / runtime `ReactLoopAgent` is a
 * superset; we only name the operations Friend needs so feature packages
 * never import `@deepseek-ai/dsh-agent`.
 */
export interface FriendAgentHandle {
  readonly id: string
  followup(message: FriendUserMessage): void
  /**
   * Official `Agent.options` (`@deepseek-ai/dsh-agent`). Absent or empty
   * provider/model means prompt assembly has no `{{model}}` route.
   */
  readonly options?: {
    readonly provider?: string
    readonly model?: string
  }
}

/**
 * Owner handle from `ctx.agents.create()` / `resume()`.
 *
 * Real shape measured on rc.6, source: `dsh-friend:shape-diag agents.create() return`
 * `{ ctor:"Object", ownKeys:["agent","dispose"] }`. Dropping this object does
 * not dispose the agent — `dispose` is a capability, not a finalizer.
 */
export interface FriendAgentCreateResult {
  readonly agent: FriendAgentHandle
  dispose(): Promise<void>
}

/**
 * Subset of official `CreateAgentOptions`.
 *
 * `meta.agentPreset` is only a header stamp. The standing companion
 * composition is joined in {@link FriendCreateAgentOptions.setup} via
 * `ctx.agentPresets.mount(agentCtx, id)` — the one supported call site.
 */
export interface FriendCreateAgentOptions {
  readonly sessionId: string
  readonly meta?: {
    readonly cwd?: string
    readonly agentPreset?: string
  }
  readonly agentOptions?: {
    readonly provider?: string
    readonly model?: string
    readonly maxTokens?: number
    readonly reasoningEffort?: string
  }
  /**
   * Official: `CreateAgentOptions.setup` (`@deepseek-ai/dsh-agent`).
   * Awaited after `agentCtx` is minted and before the session is published.
   */
  readonly setup?: (agentCtx: unknown) => void | Promise<void>
}

/** Subset of official `ResumeAgentOptions`. */
export interface FriendResumeAgentOptions {
  readonly resumeSessionId: string
  readonly agentOptions?: FriendCreateAgentOptions['agentOptions']
  readonly setup?: FriendCreateAgentOptions['setup']
}

/**
 * Minimal registry surface matching the real `ctx.agents` (`AgentRegistry`).
 *
 * Real shape measured on rc.6, source: `dsh-friend:shape-diag ctx.agents`
 * (`create#1` / `resume#1` / `get#1` on the prototype). Tests must return
 * {@link FriendAgentCreateResult} from `create` / `resume` — a bare agent
 * hides the unwrap that production needs.
 */
export interface FriendAgentRegistry {
  get(id: string): FriendAgentHandle | undefined
  create(options: FriendCreateAgentOptions): Promise<FriendAgentCreateResult>
  resume?(options: FriendResumeAgentOptions): Promise<FriendAgentCreateResult>
}

/**
 * Look up a live agent.
 *
 * Official: `ctx.agents.get(id)` (`@deepseek-ai/dsh-agent`).
 * Real shape measured on rc.6: returns `ReactLoopAgent` directly (not a wrapper).
 */
export function getLiveAgent(
  registry: FriendAgentRegistry,
  id: string,
): FriendAgentHandle | undefined {
  return registry.get(id)
}

/**
 * Unwrap `{ agent, dispose }` from `create()` / `resume()`.
 *
 * Real shape measured on rc.6, source: `dsh-friend:shape-diag agents.create() return`.
 */
export function unwrapCreatedAgent(result: FriendAgentCreateResult): FriendAgentHandle {
  const agent = result.agent
  if (agent === undefined || typeof agent.followup !== 'function') {
    throw new Error('dsh-friend: agents.create/resume did not return { agent } with followup()')
  }
  return agent
}

/**
 * Create and publish an agent; return the live {@link FriendAgentHandle}.
 *
 * Official: `ctx.agents.create(options)` resolves `{ agent, dispose }`.
 * Real shape measured on rc.6, source: `dsh-friend:shape-diag agents.create() return`.
 */
export async function createAgent(
  registry: FriendAgentRegistry,
  options: FriendCreateAgentOptions,
): Promise<FriendAgentHandle> {
  return unwrapCreatedAgent(await registry.create(options))
}

/**
 * Resume a persisted session. Returns `undefined` when resume is unavailable
 * or the factory rejects (deleted / corrupt log) — never throws.
 *
 * Official: `ctx.agents.resume({ resumeSessionId })` (`@deepseek-ai/dsh-agent`).
 * Real shape measured on rc.6: same `{ agent, dispose }` wrapper as `create()`;
 * missing id throws `session "…" not found`.
 */
export async function resumeAgent(
  registry: FriendAgentRegistry,
  sessionId: string,
  extras?: Pick<FriendCreateAgentOptions, 'agentOptions' | 'setup'>,
): Promise<FriendAgentHandle | undefined> {
  if (registry.resume === undefined) {
    return undefined
  }
  try {
    return unwrapCreatedAgent(await registry.resume({
      resumeSessionId: sessionId,
      ...extras,
    }))
  } catch {
    return undefined
  }
}

/**
 * Build a user-role message for `agent.followup()`.
 *
 * Official constructor is `createUserMessage({ content, source })`
 * (`@deepseek-ai/dsh-llm`). Shared does not take `dsh-llm` as a peer yet
 * (it is not in this package's declared SDK surface), so this helper
 * emits the same structural shape with a fresh UUID. If a later runtime
 * starts requiring `freezeMessage`, wrap `createUserMessage` here.
 */
export function createFriendUserMessage(text: string): FriendUserMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

/**
 * Queue one ordinary follow-up turn.
 *
 * Official: `agent.followup(message)` (`@deepseek-ai/dsh-agent`).
 * Real shape measured on rc.6: `ReactLoopAgent.followup#1` lives on the
 * prototype of `create().agent` / `get(id)`, not on the create-result wrapper.
 */
export function followupText(agent: FriendAgentHandle, text: string): void {
  agent.followup(createFriendUserMessage(text))
}
