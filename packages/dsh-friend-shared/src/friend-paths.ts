import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** More specific than `DSH_HOME`: the friend data root itself (`…/friend`). */
export const FRIEND_DATA_DIR_ENV = 'FRIEND_DATA_DIR'

/** dsh profile home. Friend data lives at `<DSH_HOME>/friend`. */
export const DSH_HOME_ENV = 'DSH_HOME'

export type FriendDataDirEnv = Readonly<Record<string, string | undefined>>

export type ResolveFriendDataDirOptions = {
  /**
   * Absolute-or-relative friend data root. Highest priority.
   * This is the directory that contains `characters/`, not the dsh home.
   */
  override?: string
  /** dsh home (`<dshHome>/friend` becomes the data root). */
  dshHome?: string
  /**
   * Environment bag. Defaults to `process.env`.
   * Tests should pass `{}` or an explicit map so a real `DSH_HOME` cannot leak.
   */
  env?: FriendDataDirEnv
  /** User home used only for the `~/.dsh/friend` fallback. */
  homedir?: string
}

/**
 * Resolve the friend data root.
 *
 * Priority (first non-empty wins):
 * 1. `options.override`
 * 2. `FRIEND_DATA_DIR`
 * 3. `options.dshHome`
 * 4. `DSH_HOME` → `<DSH_HOME>/friend`
 * 5. `<homedir>/.dsh/friend`
 *
 * Never hard-codes `~/.dsh`. Smoke tests isolate a temporary `DSH_HOME`;
 * unit tests inject `override` under `os.tmpdir()`.
 *
 * This is the single implementation. Feature packages (persona, stage, …)
 * must call or re-export this function — do not copy the priority list.
 */
export function resolveFriendDataDir(options: ResolveFriendDataDirOptions = {}): string {
  const env = options.env ?? process.env
  const override = firstNonEmpty(options.override, env[FRIEND_DATA_DIR_ENV])
  if (override !== undefined) {
    return resolve(override)
  }

  const dshHome = firstNonEmpty(options.dshHome, env[DSH_HOME_ENV])
  if (dshHome !== undefined) {
    return join(resolve(dshHome), 'friend')
  }

  return join(options.homedir ?? homedir(), '.dsh', 'friend')
}

/**
 * Resolve the dsh harness home (the parent of `friend/` and `.agent-presets/`).
 *
 * Priority (first non-empty wins):
 * 1. `options.dshHome`
 * 2. `DSH_HOME`
 * 3. `<homedir>/.dsh`
 *
 * Tests must inject `dshHome` or `env.DSH_HOME` under `os.tmpdir()`.
 */
export function resolveDshHome(options: ResolveFriendDataDirOptions = {}): string {
  const env = options.env ?? process.env
  const dshHome = firstNonEmpty(options.dshHome, env[DSH_HOME_ENV])
  if (dshHome !== undefined) {
    return resolve(dshHome)
  }
  return join(options.homedir ?? homedir(), '.dsh')
}

function firstNonEmpty(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value === undefined) continue
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}
