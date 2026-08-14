import type { UserConfig } from 'tsdown'

import { PLATFORM_MODULES } from './web-platform.ts'

/** Specifiers resolved from the dsh web loader table — never bundle these. */
export const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES]

/**
 * Workspace specifiers that are **not** platform seeds. Production deps are
 * external by default; without this, `require("@wishp3/dsh-friend-shared/universal")`
 * lands in the client factory and the loader throws at runtime.
 */
export const CLIENT_ALWAYS_BUNDLE: readonly string[] = [
  '@wishp3/dsh-friend-shared/universal',
]

/**
 * Official rc.6 `package.json#dsh.client` shape.
 * Required: `platform`, `inject`. Optional: `immediately`.
 *
 * The package manifest is `"type": "module"` (host `lib/index.js` is ESM).
 * That does **not** make the client payload ESM — see {@link wrapDshClientModule}.
 */
export type DshClientDeclaration = {
  platform: string
  inject: readonly string[]
  immediately?: boolean
}

export type FriendPluginBuildOptions = {
  /** npm package name, used as the tsdown config `name`. */
  name: string
  /** When true, also emit `src/client.ts` → `lib/client.js`. */
  client?: boolean
}

export type DshClientBuildOptions = {
  /** npm package name, stamped onto the client build label and loader id. */
  packageName: string
}

const sharedLibrary = {
  outDir: 'lib',
  format: ['esm'],
  target: 'es2024',
  dts: true,
  hash: false,
  // `platform: 'node'` would default this on and emit `.mjs`; exports point at `.js`.
  fixedExtension: false,
  sourcemap: true,
  exports: false,
} as const satisfies Partial<UserConfig>

/** Classic-script factory preamble. Must stay inside `factory(require)`. */
const LOADER_INTRO = 'var module = { exports: {} }; var exports = module.exports;'
const LOADER_FOOTER = 'return module.exports; } });'

/** `window.__ModuleLoader__.load({ id, factory: (require) => {` opener. */
export function dshClientLoaderBanner(packageName: string): string {
  return `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(packageName)},\n\tfactory: (require) => {`
}

/**
 * Wrap a CJS factory body in the dsh web client-module handoff.
 *
 * Real loader (`ClientModuleSystem` in `@deepseek-ai/dsh-client-modules`):
 * classic `<script>` (not `type=module`) loads `lib/client.js`, which must
 * call `window.__ModuleLoader__.load({ id, factory })`. `materialize()` then
 * runs `factory(require)` and takes `module.exports`. A bare ESM payload
 * never registers, and the loader throws:
 * `bundle ${url} loaded without registering "${id}" via __ModuleLoader__.load`.
 *
 * tsdown applies the same strings as banner / intro / footer so declaration
 * emit still sees a real CJS module (wrapping in `renderChunk` would drop `.d.ts`).
 */
export function wrapDshClientModule(packageName: string, cjsBody: string): string {
  const body = cjsBody.endsWith('\n') ? cjsBody : `${cjsBody}\n`
  return `${dshClientLoaderBanner(packageName)}\n${LOADER_INTRO}\n${body}${LOADER_FOOTER}\n`
}

/** Node / host half: `src/index.ts` → `lib/index.js` + d.ts. Naked ESM, like official host. */
export function hostBuild(overrides: UserConfig = {}): UserConfig {
  return {
    ...sharedLibrary,
    name: 'host',
    entry: { index: 'src/index.ts' },
    platform: 'node',
    clean: true,
    deps: {
      neverBundle: true,
    },
    ...overrides,
  }
}

/**
 * Platform-neutral half: `src/universal.ts` → `lib/universal.js` (naked ESM).
 * No `__ModuleLoader__` wrap. No `node:` / browser globals.
 * Does not clean `lib/` (host writes first).
 */
export function universalBuild(overrides: UserConfig = {}): UserConfig {
  return {
    ...sharedLibrary,
    name: 'universal',
    entry: { universal: 'src/universal.ts' },
    platform: 'neutral',
    clean: false,
    deps: {
      neverBundle: true,
    },
    ...overrides,
  }
}

/**
 * Browser / client half: `src/client.ts` → `lib/client.js` (CJS factory wrapped
 * for `window.__ModuleLoader__`). Does not clean `lib/` (host writes first).
 */
export function dshClientBuild(options: DshClientBuildOptions): UserConfig {
  const banner = dshClientLoaderBanner(options.packageName)
  return {
    ...sharedLibrary,
    name: `${options.packageName}/client`,
    entry: { client: 'src/client.ts' },
    platform: 'browser',
    format: 'cjs',
    clean: false,
    // CJS-in-browser is the loader contract, not a Node legacy-module warning.
    checks: { legacyCjs: false },
    deps: {
      neverBundle: [...CLIENT_EXTERNALS],
      alwaysBundle: [...CLIENT_ALWAYS_BUNDLE],
    },
    outExtensions: () => ({
      js: '.js',
      dts: '.d.ts',
    }),
    // tsdown runs a second CJS pass with `cjsDts: true`. Wrapping that pass
    // produces a broken `.d.ts` (official harness disables dts for this reason).
    outputOptions(output, _format, context) {
      if (context.cjsDts) return
      return {
        ...output,
        entryFileNames: 'client.js',
        banner,
        intro: LOADER_INTRO,
        footer: LOADER_FOOTER,
      }
    },
  }
}

/**
 * Scaffold helper: host half, plus client half when requested.
 * Existing packages may call `hostBuild` / `dshClientBuild` directly.
 */
export function friendPluginConfig(options: FriendPluginBuildOptions): UserConfig[] {
  const configs: UserConfig[] = [hostBuild({ name: options.name })]
  if (options.client === true) {
    configs.push(dshClientBuild({ packageName: options.name }))
  }
  return configs
}
