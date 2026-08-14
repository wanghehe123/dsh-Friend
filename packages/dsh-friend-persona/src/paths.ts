import { join } from 'node:path'

export {
  DSH_HOME_ENV,
  FRIEND_DATA_DIR_ENV,
  resolveDshHome,
  resolveFriendDataDir,
  type FriendDataDirEnv,
  type ResolveFriendDataDirOptions,
} from '@wish233/dsh-friend-shared'

export function charactersDir(dataDir: string): string {
  return join(dataDir, 'characters')
}

export function personaFilePath(dataDir: string, slug: string): string {
  return join(dataDir, 'characters', slug, 'persona.json')
}

/** Growth-system beliefs file injected into the persona prompt section when present. */
export function beliefsFilePath(dataDir: string, slug: string): string {
  return join(dataDir, 'characters', slug, 'beliefs.md')
}

/**
 * Official user-root directory name scanned by `ctx.agentPresets`
 * (`includeUserRoot` defaults true). Same string as
 * `@deepseek-ai/dsh-agent-presets` `USER_PRESET_DIR`.
 */
export const USER_AGENT_PRESETS_DIR = '.agent-presets'

export function userAgentPresetsDir(dshHome: string): string {
  return join(dshHome, USER_AGENT_PRESETS_DIR)
}
