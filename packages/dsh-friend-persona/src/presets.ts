import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  FRIEND_PRESET_IDS,
  registerPreset,
  restrictTools,
  type FriendPresetContext,
  type FriendToolContext,
} from '@wish233/dsh-friend-shared'

import { userAgentPresetsDir } from './paths.ts'

/**
 * Memory tools (W-M5-3). Must stay equal to
 * `@wish233/dsh-friend-memory` `MEMORY_TOOL_NAMES` / `createMemoryTools()`.
 * Locked from this package's memory-tools-consistency test via memory's
 * public export (no cross-package relative import).
 */
export const MEMORY_TOOLS = ['memory_append', 'memory_search', 'memory_get'] as const

/**
 * Stage performance tools (W-M4-7). Must stay equal to
 * `@wish233/dsh-friend-stage` `STAGE_TOOL_NAMES` / `createPerformanceTools()`.
 * Locked from stage's friend-data-root-consistency test via this package's
 * public export (no cross-package relative import).
 */
export const STAGE_TOOLS = ['set_expression', 'play_motion', 'play_cue'] as const

/** Machine-parseable line after `ctx.agentPresets.resolve(id)` succeeds. */
export const PRESET_READY_LOG_EVENT = 'dsh-friend:preset-ready'

export function formatPresetReadyLog(id: string): string {
  return `${PRESET_READY_LOG_EVENT} ${id}`
}

/**
 * Host-plane tools the companion is allowed to inherit.
 * `notify` is the system-notification tool name from the migration plan.
 * `get_current_time` is the documented time-tool fallback (no official MCP
 * time plugin in rc.6).
 */
export const COMPANION_HOST_TOOLS = ['notify', 'get_current_time'] as const

/**
 * Plus-only inherited globals. Names match official rc.6 tools:
 * `web_search` (`@deepseek-ai/dsh-tool-web`) and `read` (`@deepseek-ai/dsh-tool-fs`).
 * We do **not** allow `write` / `edit` / `bash` / `web_fetch`.
 */
export const PLUS_EXTRA_TOOLS = ['web_search', 'read'] as const

/** `friend-companion` restrict allowlist. */
export const COMPANION_TOOL_ALLOWLIST = [
  ...MEMORY_TOOLS,
  ...STAGE_TOOLS,
  ...COMPANION_HOST_TOOLS,
] as const

/** `friend-companion-plus` restrict allowlist. Super-set of companion. */
export const PLUS_TOOL_ALLOWLIST = [
  ...COMPANION_TOOL_ALLOWLIST,
  ...PLUS_EXTRA_TOOLS,
] as const

export const FRIEND_PRESET_DIRECTORY_IDS = [
  FRIEND_PRESET_IDS.companion,
  FRIEND_PRESET_IDS.companionPlus,
] as const

export type CompanionAllowlistKind = 'companion' | 'plus'

export function allowlistFor(kind: CompanionAllowlistKind): readonly string[] {
  return kind === 'plus' ? PLUS_TOOL_ALLOWLIST : COMPANION_TOOL_ALLOWLIST
}

/**
 * Directory that ships `presets/<id>/agent.cordis.yml`.
 *
 * Resolved from this module's `import.meta.url`. After tsdown bundles into
 * `lib/index.js`, `../presets` is still the package-root `presets/` folder
 * (the same path tests see when they import `src/presets.ts`).
 */
export function resolveShippedPresetsRoot(): string {
  return fileURLToPath(new URL('../presets', import.meta.url))
}

/**
 * Plan B: copy shipped preset directories into the official user root
 * `<dshHome>/.agent-presets/<id>/`, which `ctx.agentPresets` scans by default
 * (`includeUserRoot: true`). Discovery re-reads roots on every `resolve()`,
 * so a copy in this same `apply()` is visible to the fail-loud assertion.
 *
 * Overwrites our files on each start so package upgrades propagate.
 */
export async function publishShippedPresets(options: {
  dshHome: string
  sourceRoot?: string
}): Promise<{ destRoot: string; ids: readonly string[] }> {
  const sourceRoot = options.sourceRoot ?? resolveShippedPresetsRoot()
  const destRoot = userAgentPresetsDir(options.dshHome)
  await mkdir(destRoot, { recursive: true })

  for (const id of FRIEND_PRESET_DIRECTORY_IDS) {
    const from = join(sourceRoot, id)
    const to = join(destRoot, id)
    await mkdir(dirname(to), { recursive: true })
    await cp(from, to, { recursive: true, force: true })
  }

  return { destRoot, ids: FRIEND_PRESET_DIRECTORY_IDS }
}

/**
 * Startup fail-loud: both shipped ids must resolve and must not be broken.
 * Official: `ctx.agentPresets.resolve(id)` via compat `registerPreset`.
 */
export async function assertFriendPresets(
  ctx: FriendPresetContext,
  expectedRoot: string,
): Promise<void> {
  for (const id of FRIEND_PRESET_DIRECTORY_IDS) {
    try {
      await registerPreset(ctx, { id })
      console.info(formatPresetReadyLog(id))
    } catch (error) {
      const expected = join(expectedRoot, id, 'agent.cordis.yml')
      const cause = error instanceof Error ? error.message : String(error)
      throw new Error(
        `dsh-friend: preset "${id}" was not discovered or is broken. Expected ${expected}. ${cause}`,
        { cause: error },
      )
    }
  }
}

/**
 * Restrict inherited global tools on the **calling** scoped context.
 *
 * Official `tools.restrict` throws on a host-global ctx. Call only from the
 * companion preset standing mount. Same-scope registrations (memory / stage
 * tools, once those packages implement them) stay visible even if they are
 * also named here — restrict only filters inherited globals.
 */
export function restrictCompanionTools(
  ctx: FriendToolContext,
  kind: CompanionAllowlistKind,
): () => void {
  return restrictTools(ctx, { allow: [...allowlistFor(kind)] })
}
