import {
  FRIEND_SETTINGS_NAMESPACES,
  logPluginMount,
  registerFriendSettings,
  resolveFriendDataDir,
  type FriendDefaultModelContext,
  type FriendModelCatalog,
  type FriendRouteContext,
  type ResolveFriendDataDirOptions,
} from '@wish233/dsh-friend-shared'

import {
  createFriendCoreSettingsSchema,
  DEFAULT_CORE_SETTINGS_ENTRY,
} from './settings-schema.ts'
import type { HostModelViewsDeps } from './host-models.ts'
import { createOfficialSanitizeSeams } from './host-seams.ts'
import { registerSettingsRoutes, type SettingsRouteDeps } from './routes.ts'
import { createShellHeartbeatStore } from './shell-heartbeat.ts'
import type { SettingsReader } from './project.ts'
import type { SettingsSanitizeSeams } from './sanitize.ts'

export const name = '@wish233/dsh-friend-settings'

/**
 * Cordis services this plugin reads. Accessing `ctx.webServer` / `ctx.settings`
 * / `ctx.agentDefaultModel` / `ctx.llm` without the matching inject throws
 * and takes down the host tree.
 */
export const inject = ['webServer', 'settings', 'agentDefaultModel', 'llm'] as const

export type FriendSettingsContext = {
  effect?(
    execute: () => (() => void | Promise<void>),
    label?: string,
  ): () => void | Promise<void>
  webServer?: FriendRouteContext['webServer']
  settings?: SettingsReader & {
    update?(namespace: string, patch: Record<string, unknown>): Promise<void>
  }
  agentDefaultModel?: FriendDefaultModelContext['agentDefaultModel']
  llm?: FriendModelCatalog
}

export type FriendSettingsApplyOptions = ResolveFriendDataDirOptions & {
  dataDir?: string
  seams?: SettingsSanitizeSeams
  /**
   * Test seam. Production builds the schema via shared `Schema` and always
   * registers `friend-core`. Pass a schema here only to override that default.
   */
  coreSchema?: Parameters<typeof registerFriendSettings>[2]
  /** Test hook. Production uses the in-memory heartbeat store. */
  shellConnected?: () => boolean
}

export type FriendSettingsHandle = {
  dispose: () => void
  dataDir: string
}

export function apply(
  ctx: FriendSettingsContext = {},
  config: FriendSettingsApplyOptions = {},
): () => void {
  return applySettings(ctx, config).dispose
}

export function applySettings(
  ctx: FriendSettingsContext = {},
  config: FriendSettingsApplyOptions = {},
): FriendSettingsHandle {
  logPluginMount(name)

  const dataDir = config.dataDir ?? resolveFriendDataDir({
    ...(config.override !== undefined ? { override: config.override } : {}),
    ...(config.dshHome !== undefined ? { dshHome: config.dshHome } : {}),
    ...(config.env !== undefined ? { env: config.env } : {}),
    ...(config.homedir !== undefined ? { homedir: config.homedir } : {}),
  })

  registerFriendSettings(
    ctx,
    FRIEND_SETTINGS_NAMESPACES.core,
    config.coreSchema ?? createFriendCoreSettingsSchema(),
    DEFAULT_CORE_SETTINGS_ENTRY,
  )

  const settings = ctx.settings
  const agentDefaultModel = ctx.agentDefaultModel
  const llm = ctx.llm

  const models: HostModelViewsDeps | undefined = agentDefaultModel === undefined
    ? undefined
    : {
        getDefaultModel: () => agentDefaultModel.currentSelection(),
        getSettings: (namespace) => settings?.get(namespace),
        ...(llm !== undefined ? { catalog: llm } : {}),
      }

  const seams: SettingsSanitizeSeams = {
    ...createOfficialSanitizeSeams(),
    ...config.seams,
  }

  const routeDeps: SettingsRouteDeps = {
    dataDir,
    seams,
    shellHeartbeat: createShellHeartbeatStore(),
    ...(settings !== undefined ? { settings } : {}),
    ...(models !== undefined ? { models } : {}),
    ...(config.shellConnected !== undefined ? { shellConnected: config.shellConnected } : {}),
  }

  const routeCtx = asRouteContext(ctx)
  if (routeCtx !== undefined) {
    registerSettingsRoutes(routeCtx, routeDeps)
  } else {
    console.warn(`[${name}] ctx.webServer/effect missing; settings routes not mounted`)
  }

  return {
    dataDir,
    dispose() {},
  }
}

function asRouteContext(ctx: FriendSettingsContext): FriendRouteContext | undefined {
  if (ctx.webServer === undefined || ctx.effect === undefined) {
    return undefined
  }
  return { webServer: ctx.webServer, effect: ctx.effect }
}

export {
  ABOUT_NOTICES,
  FRIEND_PACKAGE_VERSION,
  createAboutPayload,
} from './about.ts'
export {
  CORE_SETTING_FIELDS,
  CORE_SETTINGS_NAMESPACE,
  DEFAULT_CHARACTER_SLUG,
  DEFAULT_CORE_SETTINGS,
  PERSONA_CURRENT_SLUG_FIELD,
  childControlsEnabled,
  readCoreSettings,
  readCurrentSlug,
  resolveUiLanguage,
} from './core-settings.ts'
export { listCharacters } from './characters.ts'
export { buildZipStore, isExcludedExportPath, listExportEntries, zipEntryNames } from './export-zip.ts'
export { buildModelInheritViews } from './host-models.ts'
export { EN, I18N_KEYS, ZH, missingI18nKeys, t } from './i18n.ts'
export { createModelSectionForm, overrideToInput } from './model-form.ts'
export { openCommand, openDataDirectory } from './open-data-dir.ts'
export {
  FRIEND_SETTINGS_ABOUT_PATH,
  FRIEND_SETTINGS_CHARACTERS_PATH,
  FRIEND_SETTINGS_EXPORT_PATH,
  FRIEND_SETTINGS_GENERAL_ITEM_ID,
  FRIEND_SETTINGS_GENERAL_ITEM_SLOT,
  FRIEND_SETTINGS_MODELS_PATH,
  FRIEND_SETTINGS_MODELS_TEST_PATH,
  FRIEND_SETTINGS_OPEN_DATA_DIR_PATH,
  FRIEND_SETTINGS_PATCH_PATH,
  FRIEND_SETTINGS_SECTION_ID,
  FRIEND_SETTINGS_SECTION_ORDER,
  FRIEND_SETTINGS_SECTION_SLOT,
  FRIEND_SETTINGS_SHELL_PATH,
  FRIEND_SETTINGS_SNAPSHOT_PATH,
  FRIEND_SETTINGS_UPDATE_PATH,
  FRIEND_SHELL_HEARTBEAT_PATH,
} from './paths.ts'
export { createPluginCardForm, draftFromCardSources } from './plugin-card.ts'
export { createOfficialSanitizeSeams } from './host-seams.ts'
export { projectClientSettings, projectDocuments } from './project.ts'
export { FRIEND_GITHUB_RELEASES_API, FRIEND_GITHUB_RELEASES_PAGE, FRIEND_GITHUB_REPO } from './github-repo.ts'
export { asFriendHostSettings, parseSettingsPatch } from './patch.ts'
export { createSettingsRoutes, registerSettingsRoutes } from './routes.ts'
export {
  SHELL_HEARTBEAT_MAX_BYTES,
  SHELL_ONLINE_WINDOW_MS,
  SHELL_PLATFORMS,
  createShellHeartbeatStore,
  parseShellHeartbeat,
  projectShellStatus,
  readClientShellStatus,
} from './shell-heartbeat.ts'
export {
  FRIEND_SECRET_FIELDS,
  defaultProjectAsr,
  defaultProjectTts,
  hasSecretMaterial,
  projectModelOverride,
  stripSecretFields,
} from './sanitize.ts'
export {
  CONFIG_CENTER_SECTIONS,
  CONFIG_HASH_PREFIX,
  createOverlayController,
  createSectionLoader,
  parseConfigHash,
  serializeConfigHash,
} from './sections.ts'
export { describeAllSections } from './section-forms.ts'
export { checkForUpdate } from './update-check.ts'
