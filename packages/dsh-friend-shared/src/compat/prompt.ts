/**
 * Minimal host surface for system-prompt sections.
 *
 * `text` uses a call-signature so official `(assembleCtx) => string`
 * callbacks remain assignable (method bivariance).
 */
export interface FriendPromptSection {
  readonly name: string
  readonly order: number
  readonly text: string | { (context: unknown): string }
  readonly complete?: boolean
}

export interface FriendPromptContext {
  systemPrompt: {
    section(section: FriendPromptSection): () => void
  }
}

/**
 * Register an ordered system-prompt section in the calling context's scope.
 *
 * Official: `ctx.systemPrompt.section(section)` (`@deepseek-ai/dsh-system-prompt`).
 * Real shape measured on rc.6, source: `dsh-friend:shape-diag ctx.systemPrompt`:
 * `SystemPrompt.section#1` on the prototype. Not invoked on a companion-preset
 * standing mount in that dump (host ctx only).
 * The official return value is already the Cordis effect disposer — this
 * wrapper returns it unchanged and must not wrap `ctx.effect` a second time.
 *
 * Call from a preset standing mount (or `agent.ctx`), not the host-global
 * ctx, or the section is visible to every session.
 *
 * Replacement: if `section` is renamed, only this function changes.
 */
export function registerPromptSection(
  ctx: FriendPromptContext,
  section: FriendPromptSection,
): () => void {
  return ctx.systemPrompt.section(section)
}
