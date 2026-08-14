/** Directory name / roster id; must match `/^[a-z0-9][a-z0-9-]*$/`. */
export const FRIEND_PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

export const FRIEND_PRESET_IDS = {
  companion: 'friend-companion',
  companionPlus: 'friend-companion-plus',
} as const

export type FriendPresetId =
  | (typeof FRIEND_PRESET_IDS)[keyof typeof FRIEND_PRESET_IDS]
  | (string & {})

/**
 * Minimal host surface: only the preset roster, not the whole Context.
 * A real DSH `Context` with `ctx.agentPresets` structurally satisfies this.
 */
export interface FriendPresetContext {
  agentPresets: {
    resolve(id?: string): Promise<{ id: string; broken?: string }>
    list(): Promise<ReadonlyArray<{ id: string; broken?: string }>>
  }
}

export interface FriendPresetSpec {
  id: FriendPresetId
}

/**
 * Startup fail-loud assertion that a shipped preset directory was discovered
 * and is mountable. rc.6 has no `registerPreset` API.
 *
 * Official: `ctx.agentPresets.resolve(id)` (`@deepseek-ai/dsh-agent-presets`).
 * Real shape measured on rc.6, source: `dsh-friend:shape-diag ctx.agentPresets`:
 * `AgentPresets.resolve#1` / `list#0` on the prototype. `preset-ready` lines
 * confirm `resolve()` succeeds for both shipped ids.
 * Presets are directories containing `agent.cordis.yml`, found via
 * `agent-presets.roots` (or `~/.dsh/.agent-presets/`). This function does
 * not invent a register call.
 *
 * Replacement: if a real register API appears, implement it here and keep
 * this fail-loud check as the "directory is visible" guard.
 */
export async function registerPreset(
  ctx: FriendPresetContext,
  spec: FriendPresetSpec,
): Promise<void> {
  if (!FRIEND_PRESET_ID_PATTERN.test(spec.id)) {
    throw new Error(`dsh-friend: invalid preset id "${spec.id}"`)
  }
  const resolved = await ctx.agentPresets.resolve(spec.id)
  if (resolved.broken) {
    throw new Error(`dsh-friend: preset "${spec.id}" is broken: ${resolved.broken}`)
  }
}
