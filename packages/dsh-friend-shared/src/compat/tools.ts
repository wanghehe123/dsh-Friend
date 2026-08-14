import { defineTool, type ToolDefinition, type ToolRestriction } from '@deepseek-ai/dsh-tools'

/**
 * Official: `defineTool` (`@deepseek-ai/dsh-tools`).
 * Replacement: re-point this re-export if the helper moves or the DSL changes.
 */
export { defineTool }
export type { ToolDefinition, ToolRestriction }

/**
 * Minimal host surface for tool registration and scoped restriction.
 * A real DSH `Context` with `ctx.tools` structurally satisfies this shape.
 */
export interface FriendToolContext {
  tools: {
    register(definition: ToolDefinition): () => void
    restrict(filter: ToolRestriction): () => void
    /**
     * Official: `ctx.tools.get(name)` (`@deepseek-ai/dsh-tools`).
     * Omitted scope is the global view — the only names `restrict()` may cite.
     */
    get?(name: string): unknown
  }
}

/**
 * Register a tool in the calling context's scope.
 *
 * Official: `ctx.tools.register(definition)` (`@deepseek-ai/dsh-tools`).
 * Real shape measured on rc.6, source: `dsh-friend:shape-diag ctx.tools`:
 * `ToolRuntime.register#1` / `restrict#1` on the prototype. Not invoked on a
 * companion-preset standing mount in that dump (host ctx only).
 * The official return value is already the Cordis effect disposer — this
 * wrapper returns it unchanged and must not wrap `ctx.effect` a second time.
 *
 * Call from a preset standing mount (or `agent.ctx`). A host-global
 * registration is visible to every session, including coding agents.
 *
 * Replacement: if `register` is renamed, only this function changes.
 */
export function registerTool(
  ctx: FriendToolContext,
  definition: ToolDefinition,
): () => void {
  return ctx.tools.register(definition)
}

/**
 * Restrict inherited global tools for the calling scoped context.
 *
 * Official: `ctx.tools.restrict(filter)` (`@deepseek-ai/dsh-tools`).
 * Must run on a scoped ctx (preset standing mount / `agent.ctx`). Calling
 * this on the host-global ctx throws — a process-wide mask would hide tools
 * from every agent.
 *
 * Restrictions intersect and only filter inherited globals; tools registered
 * in the same scope remain visible.
 *
 * Replacement: if `restrict` is renamed, only this function changes.
 */
export function restrictTools(
  ctx: FriendToolContext,
  filter: ToolRestriction,
): () => void {
  return ctx.tools.restrict(filter)
}
