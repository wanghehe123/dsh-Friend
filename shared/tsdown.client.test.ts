/**
 * Client-half build contract, pinned to the published 0.1.0-rc.6 loader.
 *
 * Evidence 1 — official client *payload* is loader-wrapped CJS, not ESM:
 *   `node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js` starts with
 *   `window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-client-runtime", factory: (require) => { ... }`.
 *   The same package's host `lib/index.js` is naked ESM. The manifest is
 *   `"type": "module"`; that does **not** mean the client payload is ESM.
 *   Do not revert this preset to bare ESM.
 *
 * Evidence 2 — loader body lives in the installed dsh CLI, not in this repo:
 *   `/Users/wish233/.nvm/versions/node/v24.12.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js`
 *   `ClientModuleSystem`:
 *   - installs `globalThis.__ModuleLoader__ = { load(handoff) { factories.set(handoff.id, handoff.factory) } }`
 *     (repeat install throws `already installed (double boot?)`)
 *   - `arrive()` loads the bundle with a classic `<script>` tag (not `type=module`)
 *   - if the factory is missing after load, throws
 *     `bundle ${url} loaded without registering "${id}" via __ModuleLoader__.load`
 *   - `materialize()` calls `factory(this.makeRequire(edges))` and takes `module.exports`
 *   - `makeRequire` only answers platform seeds, shell statics, or registered factories;
 *     otherwise throws `a build-time externals drift, or a forbidden cross-plugin value import`
 *   - `id.endsWith('/client') ? id.slice(0, -7) : id` so `require("<pkg>/client")` → `<pkg>`
 *
 * Manifest `"type": "module"` and payload `window.__ModuleLoader__.load` coexist.
 * Looking only at package.json is how this was wrongly flipped to ESM last time.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  CLIENT_ALWAYS_BUNDLE,
  CLIENT_EXTERNALS,
  dshClientBuild,
  type DshClientDeclaration,
  hostBuild,
  universalBuild,
  wrapDshClientModule,
} from './tsdown.client.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOADER_PREFIX = 'window.__ModuleLoader__.load({'
const MISSING_CLIENT_HINT = 'lib/client.js missing — run `pnpm -r build` first'

async function readOfficialClient(packageName: string): Promise<{
  type?: string
  exports?: Record<string, { types?: string; default?: string } | string>
  dsh?: { client?: DshClientDeclaration }
}> {
  const manifestPath = join(ROOT, 'node_modules', packageName, 'package.json')
  return JSON.parse(await readFile(manifestPath, 'utf8')) as Awaited<
    ReturnType<typeof readOfficialClient>
  >
}

type DshClientPackage = {
  name: string
  dir: string
  clientJs: string
}

async function listDshClientPackages(): Promise<DshClientPackage[]> {
  const packagesDir = join(ROOT, 'packages')
  const dirs = await readdir(packagesDir, { withFileTypes: true })
  const found: DshClientPackage[] = []
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue
    const dir = join(packagesDir, entry.name)
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      name?: string
      dsh?: { client?: unknown }
    }
    if (manifest.dsh?.client === undefined || typeof manifest.name !== 'string') continue
    found.push({
      name: manifest.name,
      dir,
      clientJs: join(dir, 'lib/client.js'),
    })
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Minimal `ClientModuleSystem.load` + `materialize` stand-in: execute the
 * classic-script payload, then call the registered factory with a require
 * that only answers seeds / already-registered factories.
 */
function materializeLoaderPayload(
  source: string,
  id: string,
  staticModules: Record<string, unknown> = {},
): unknown {
  const factories = new Map<string, (require: (spec: string) => unknown) => unknown>()
  const loadCache = new Map<string, unknown>()
  const loader = {
    load(handoff: { id: string; factory: (require: (spec: string) => unknown) => unknown }) {
      if (factories.has(handoff.id)) {
        throw new Error(`client-modules: duplicate factory registration for "${handoff.id}" (bundle executed twice without invalidate?)`)
      }
      factories.set(handoff.id, handoff.factory)
    },
  }
  const globalWithWindow = globalThis as typeof globalThis & {
    window?: { __ModuleLoader__?: typeof loader }
    __ModuleLoader__?: typeof loader
  }
  const previousWindow = globalWithWindow.window
  const previousLoader = globalWithWindow.__ModuleLoader__
  globalWithWindow.window = { ...previousWindow, __ModuleLoader__: loader }
  globalWithWindow.__ModuleLoader__ = loader
  try {
    // Classic <script> semantics: the file is not an ES module.
    new Function(source)()
  } finally {
    if (previousWindow === undefined) {
      delete globalWithWindow.window
    } else {
      globalWithWindow.window = previousWindow
    }
    if (previousLoader === undefined) {
      delete globalWithWindow.__ModuleLoader__
    } else {
      globalWithWindow.__ModuleLoader__ = previousLoader
    }
  }
  if (!factories.has(id)) {
    throw new Error(`client-modules: bundle loaded without registering "${id}" via __ModuleLoader__.load`)
  }
  const stripClientSuffix = (spec: string) => (spec.endsWith('/client') ? spec.slice(0, -7) : spec)
  const requireFn = (spec: string): unknown => {
    if (Object.hasOwn(staticModules, spec)) return staticModules[spec]
    const resolved = stripClientSuffix(spec)
    const cached = loadCache.get(resolved)
    if (cached !== undefined) return cached
    const factory = factories.get(resolved)
    if (factory === undefined) {
      throw new Error(
        `client-modules: require("${spec}") missed the module table — not a platform seed word, not a shell-own module, and no registered factory (a build-time externals drift, or a forbidden cross-plugin value import)`,
      )
    }
    const exported = factory(requireFn)
    loadCache.set(resolved, exported)
    return exported
  }
  return requireFn(id)
}

describe('dsh client build preset', () => {
  it('wrapDshClientModule emits the loader handoff the classic script must call', () => {
    const wrapped = wrapDshClientModule(
      '@wishp3/dsh-friend-stage',
      'exports.answer = 42;\n',
    )

    expect(wrapped.startsWith(LOADER_PREFIX)).toBe(true)
    expect(wrapped).toContain('id: "@wishp3/dsh-friend-stage"')
    expect(wrapped).toContain('factory: (require) => {')
    expect(wrapped).toContain('var module = { exports: {} };')
    expect(wrapped).toContain('var exports = module.exports;')
    expect(wrapped).toContain('exports.answer = 42;')
    expect(wrapped).toContain('return module.exports;')
  })

  it('materializes the wrapped CJS factory the way ClientModuleSystem does', () => {
    const wrapped = wrapDshClientModule(
      '@wishp3/dsh-friend-stage',
      'exports.apply = function apply() { return require("react").version };\n',
    )
    const exported = materializeLoaderPayload(wrapped, '@wishp3/dsh-friend-stage', {
      react: { version: '19.0.0' },
    }) as { apply: () => string }

    expect(exported.apply()).toBe('19.0.0')
  })

  it('normalizes require("<pkg>/client") to "<pkg>" like the real loader', () => {
    const wrapped = wrapDshClientModule(
      '@wishp3/dsh-friend-shared',
      'exports.from = "shared";\n',
    )
    const consumer = wrapDshClientModule(
      '@wishp3/dsh-friend-stage',
      'exports.shared = require("@wishp3/dsh-friend-shared/client");\n',
    )
    const factories = new Map<string, (require: (spec: string) => unknown) => unknown>()
    const loader = {
      load(handoff: { id: string; factory: (require: (spec: string) => unknown) => unknown }) {
        factories.set(handoff.id, handoff.factory)
      },
    }
    const globalWithWindow = globalThis as typeof globalThis & {
      window?: { __ModuleLoader__?: typeof loader }
    }
    const previousWindow = globalWithWindow.window
    globalWithWindow.window = { ...previousWindow, __ModuleLoader__: loader }
    try {
      new Function(wrapped)()
      new Function(consumer)()
    } finally {
      if (previousWindow === undefined) delete globalWithWindow.window
      else globalWithWindow.window = previousWindow
    }

    const loadCache = new Map<string, unknown>()
    const stripClientSuffix = (spec: string) => (spec.endsWith('/client') ? spec.slice(0, -7) : spec)
    const requireFn = (spec: string): unknown => {
      const resolved = stripClientSuffix(spec)
      const cached = loadCache.get(resolved)
      if (cached !== undefined) return cached
      const factory = factories.get(resolved)
      if (factory === undefined) {
        throw new Error(`unregistered: ${spec}`)
      }
      const exported = factory(requireFn)
      loadCache.set(resolved, exported)
      return exported
    }

    expect(requireFn('@wishp3/dsh-friend-stage')).toEqual({
      shared: { from: 'shared' },
    })
  })

  it('emits CJS client.js into lib and leaves platform modules as require() externals', () => {
    const config = dshClientBuild({ packageName: '@wishp3/dsh-friend-stage' })

    expect(config.format).toBe('cjs')
    expect(config.outDir).toBe('lib')
    expect(config.entry).toEqual({ client: 'src/client.ts' })
    expect(config.outExtensions?.({
      options: {},
      format: 'cjs',
      pkgType: 'module',
    })?.js).toBe('.js')
    expect(config.outExtensions?.({
      options: {},
      format: 'cjs',
      pkgType: 'module',
    })?.dts).toBe('.d.ts')
    expect(config.deps?.neverBundle).toEqual([...CLIENT_EXTERNALS])
    expect(config.deps?.alwaysBundle).toEqual([...CLIENT_ALWAYS_BUNDLE])
    expect(config.deps?.alwaysBundle).toEqual(expect.arrayContaining([
      '@wishp3/dsh-friend-shared/universal',
    ]))
    expect(config.deps?.neverBundle).toEqual(expect.arrayContaining([
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
    ]))
    expect(typeof config.outputOptions).toBe('function')
    const jsOutput = typeof config.outputOptions === 'function'
      ? config.outputOptions({}, 'cjs', { cjsDts: false })
      : config.outputOptions
    const dtsOutput = typeof config.outputOptions === 'function'
      ? config.outputOptions({}, 'cjs', { cjsDts: true })
      : undefined
    expect(jsOutput).toMatchObject({
      entryFileNames: 'client.js',
      banner: expect.stringContaining(LOADER_PREFIX),
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    })
    expect((jsOutput as { banner: string }).banner).toContain('id: "@wishp3/dsh-friend-stage"')
    expect(dtsOutput).toBeUndefined()
  })

  it('keeps the host half as naked ESM', () => {
    const config = hostBuild()
    expect(config.format).toEqual(['esm'])
    expect(config.entry).toEqual({ index: 'src/index.ts' })
    expect(config.outputOptions).toBeUndefined()
  })

  it('keeps the universal half as naked ESM on a neutral platform', () => {
    const config = universalBuild()
    expect(config.format).toEqual(['esm'])
    expect(config.entry).toEqual({ universal: 'src/universal.ts' })
    expect(config.platform).toBe('neutral')
    expect(config.outputOptions).toBeUndefined()
    expect(config.clean).toBe(false)
  })

  it('matches the official dsh.client declaration shape (manifest ESM ≠ payload ESM)', async () => {
    const runtime = await readOfficialClient('@deepseek-ai/dsh-client-runtime')
    const connection = await readOfficialClient('@deepseek-ai/dsh-client-connection')

    expect(runtime.type).toBe('module')
    expect(runtime.exports?.['./client']).toEqual({
      types: './lib/types/client/index.d.ts',
      default: './lib/client.js',
    })
    expect(runtime.dsh?.client).toEqual({
      inject: expect.any(Array),
      platform: 'web',
      immediately: true,
    })

    expect(connection.type).toBe('module')
    expect(connection.exports?.['./client']).toEqual({
      types: './lib/types/client/index.d.ts',
      default: './lib/client.js',
    })
    expect(connection.dsh?.client).toMatchObject({
      platform: 'web',
      inject: expect.any(Array),
    })

    const runtimePayload = await readFile(
      join(ROOT, 'node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js'),
      'utf8',
    )
    expect(runtimePayload.startsWith(LOADER_PREFIX)).toBe(true)
    expect(runtimePayload).toContain('id: "@deepseek-ai/dsh-client-runtime"')
    expect(runtimePayload).toContain('require("@deepseek-ai/cordis")')
  })
})

describe('built client.js loader contract', async () => {
  const packages = await listDshClientPackages()
  const present = packages.filter((pkg) => existsSync(pkg.clientJs))
  const missing = packages.filter((pkg) => !existsSync(pkg.clientJs))

  it.skipIf(present.length === 0)(
    present.length === 0
      ? `every dsh.client package registers via __ModuleLoader__ (${MISSING_CLIENT_HINT})`
      : 'every built dsh.client payload starts with window.__ModuleLoader__.load',
    async () => {
      expect(packages.length).toBeGreaterThan(0)
      for (const pkg of present) {
        const source = await readFile(pkg.clientJs, 'utf8')
        expect(source.startsWith(LOADER_PREFIX), `${pkg.name} ${pkg.clientJs}`).toBe(true)
        expect(source, pkg.name).toContain(`id: ${JSON.stringify(pkg.name)}`)
        const dtsPath = join(pkg.dir, 'lib/client.d.ts')
        if (existsSync(dtsPath)) {
          const dts = await readFile(dtsPath, 'utf8')
          expect(dts.startsWith(LOADER_PREFIX), `${pkg.name} client.d.ts must stay unwrapped`).toBe(false)
        }
        const exported = materializeLoaderPayload(source, pkg.name) as {
          apply?: unknown
        }
        expect(exported, pkg.name).toBeTypeOf('object')
        expect(exported.apply, `${pkg.name} apply`).toBeTypeOf('function')
      }
    },
  )

  if (missing.length > 0) {
    it.skip(
      `${missing.map((pkg) => pkg.name).join(', ')}: ${MISSING_CLIENT_HINT}`,
      () => {
        // Skip on a clean checkout (or a partial build). The assertion above
        // runs only against artifacts that actually exist.
      },
    )
  }
})
