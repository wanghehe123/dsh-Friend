/**
 * Default text-model selection, advisory catalog, and one-shot completion
 * via the official streaming call.
 *
 * Official: `ctx.agentDefaultModel.currentSelection()`
 * (`@deepseek-ai/dsh-agent-default-model`) returns a detached
 * `{ provider, model, reasoningEffort? }` — this is how rc.6 exposes
 * "the current configured text model". `ctx.llm` is the adapter registry
 * (`listProviders` / `listModels` / `resolveModelInfo`) **and** the
 * completion entry point: `LlmRuntime.stream(options)`
 * (`@deepseek-ai/dsh-llm` `lib/types/index.d.ts` 327–337) yields
 * `AsyncIterable<StreamChunk>` (`lib/types/types.d.ts` 267–297 /
 * `GenerateOptions` 312–348).
 *
 * Replacement: if `agentDefaultModel` is renamed, only {@link readDefaultModelSelection}
 * changes. If `stream` moves, only {@link streamLlm} / {@link completeViaLlmStream}
 * change. Callers of `resolveModel` keep injecting `getDefaultModel`.
 */

import { createFriendUserMessage } from './agent.ts'

/** Detached provider/model pair from `AgentDefaultModelConfig.currentSelection()`. */
export interface FriendDefaultModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/**
 * Minimal host surface for the default-model service.
 * A real DSH `Context` with `ctx.agentDefaultModel` structurally satisfies this.
 */
export interface FriendDefaultModelContext {
  agentDefaultModel: {
    currentSelection(): FriendDefaultModelSelection
  }
}

/**
 * Advisory catalog used to decide whether an override names a registered route.
 *
 * Official: `ctx.llm.listProviders()` / `ctx.llm.listModels(provider)`
 * (`@deepseek-ai/dsh-llm`). Catalog membership is advisory for request
 * routing — absence must not become a hard I/O rejection inside dsh —
 * but Friend treats "not in the catalog of any listed provider" as an
 * illegal override and falls back.
 *
 * Replacement: if those methods move, adapt this shape; `resolveModel`
 * still takes the catalog as an injected getter.
 */
export interface FriendModelCatalog {
  listProviders(): ReadonlyArray<{ id: string }>
  listModels?(
    provider: string,
  ): Promise<ReadonlyArray<{ id: string }>> | ReadonlyArray<{ id: string }>
}

/**
 * Read dsh's process-level default Agent model.
 *
 * Official: `ctx.agentDefaultModel.currentSelection()`
 * (`@deepseek-ai/dsh-agent-default-model`).
 */
export function readDefaultModelSelection(
  ctx: FriendDefaultModelContext,
): FriendDefaultModelSelection {
  return ctx.agentDefaultModel.currentSelection()
}

/**
 * Structural subset of official `GenerateOptions`
 * (`@deepseek-ai/dsh-llm` `lib/types/types.d.ts` 312–348).
 * Feature packages must not `import '@deepseek-ai/dsh-llm'` at runtime.
 */
export interface FriendGenerateOptions {
  provider: string
  model: string
  reasoningEffort?: string
  system?: string
  messages: ReadonlyArray<{
    readonly id: string
    readonly role: 'system' | 'user' | 'assistant'
    readonly content: ReadonlyArray<{ type: 'text'; text: string }>
    readonly source: { readonly kind: string }
  }>
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

/**
 * Structural subset of official `StreamChunk`
 * (`@deepseek-ai/dsh-llm` `lib/types/types.d.ts` 267–297).
 */
export type FriendStreamChunk =
  | { type: 'block-start'; index: number; blockType: string }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: { type: string; text?: string } }
  | { type: 'usage'; usage: object }
  | {
      type: 'finish'
      reason: {
        kind: string
        failure?: { message?: string; code?: string }
      }
    }

/**
 * Official `ctx.llm` surface Friend actually calls.
 *
 * `stream` is `LlmRuntime.stream` (`dsh-llm` `lib/types/index.d.ts` 337).
 * Catalog methods stay on the same object so one inject covers both.
 */
export interface FriendLlmRuntime extends FriendModelCatalog {
  stream(options: FriendGenerateOptions): AsyncIterable<FriendStreamChunk>
}

/**
 * A model already routed through a registered `ctx.llm` adapter.
 * Distinct from an openai-compat override, which has no adapter route.
 */
export interface FriendLlmRoute {
  provider: string
  model: string
  reasoningEffort?: string
}

/**
 * Require the injected `llm` service. Missing means the plugin forgot
 * `'llm'` in `inject`, or a test ctx omitted the service — not a live
 * model refusal.
 */
export function requireLlmRuntime(
  llm: FriendLlmRuntime | undefined,
  plugin: string,
): FriendLlmRuntime {
  if (llm === undefined) {
    throw new Error(`${plugin}: ctx.llm is missing; cannot call LlmRuntime.stream()`)
  }
  return llm
}

/**
 * openai-compat overrides are caller-owned HTTP (see `FriendOpenAiCompatModel`).
 * Production default / registered routes go through {@link completeViaLlmStream}.
 */
export function requireLlmRoute(
  model: { kind: string; provider?: string; model?: string; reasoningEffort?: string },
  plugin: string,
): FriendLlmRoute {
  if (model.kind !== 'registered' || typeof model.provider !== 'string' || typeof model.model !== 'string') {
    throw new Error(
      `${plugin}: openai-compat override is not dispatched through ctx.llm.stream(); use a registered provider/model`,
    )
  }
  return {
    provider: model.provider,
    model: model.model,
    ...(typeof model.reasoningEffort === 'string' ? { reasoningEffort: model.reasoningEffort } : {}),
  }
}

/**
 * Build a hand-assembled `GenerateOptions` for one system+user completion.
 *
 * Official: `GenerateOptions.system` + `messages` after the system slot
 * (`dsh-llm` `lib/types/types.d.ts` 312–325). User message shape matches
 * {@link createFriendUserMessage}.
 */
export function buildFriendGenerateOptions(input: {
  route: FriendLlmRoute
  system: string
  user: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}): FriendGenerateOptions {
  return {
    provider: input.route.provider,
    model: input.route.model,
    ...(input.route.reasoningEffort !== undefined
      ? { reasoningEffort: input.route.reasoningEffort }
      : {}),
    system: input.system,
    messages: [createFriendUserMessage(input.user)],
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  }
}

/**
 * Call `llm.stream(options)` without destructuring (keeps `this`).
 *
 * Official: `LlmRuntime.stream(options): AsyncIterable<StreamChunk>`
 * (`@deepseek-ai/dsh-llm` `lib/types/index.d.ts` 327–337).
 */
export function streamLlm(
  llm: FriendLlmRuntime,
  options: FriendGenerateOptions,
): AsyncIterable<FriendStreamChunk> {
  return llm.stream(options)
}

/**
 * Drain one `ctx.llm.stream()` call into visible assistant text.
 *
 * Adapter / selection failures become a terminal `finish` chunk with
 * `reason.kind` `error` or `aborted` (`types.d.ts` 104–111, 264–265).
 * Those are prefixed `dsh-llm` so callers can tell them apart from a
 * Friend-side refusal that never reached the runtime.
 */
export async function completeViaLlmStream(
  llm: FriendLlmRuntime,
  options: FriendGenerateOptions,
): Promise<string> {
  let text = ''
  let sawTextDelta = false
  for await (const chunk of streamLlm(llm, options)) {
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
      sawTextDelta = true
      text += chunk.text
      continue
    }
    if (
      !sawTextDelta
      && chunk.type === 'block-end'
      && chunk.block.type === 'text'
      && typeof chunk.block.text === 'string'
    ) {
      text += chunk.block.text
      continue
    }
    if (chunk.type === 'finish') {
      throwIfFinishFailed(chunk.reason)
    }
  }
  return text
}

function throwIfFinishFailed(reason: { kind: string; failure?: { message?: string; code?: string } }): void {
  if (reason.kind !== 'error' && reason.kind !== 'aborted') {
    return
  }
  const message = typeof reason.failure?.message === 'string' && reason.failure.message.length > 0
    ? reason.failure.message
    : reason.kind
  const code = typeof reason.failure?.code === 'string' && reason.failure.code.length > 0
    ? reason.failure.code
    : undefined
  throw new Error(code !== undefined ? `dsh-llm ${code}: ${message}` : `dsh-llm ${message}`)
}
