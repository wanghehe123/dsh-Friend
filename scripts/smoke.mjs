#!/usr/bin/env node
/**
 * M0 smoke: if a `dsh` CLI exists, boot `dsh web`, wait until it is reachable,
 * assert `GET /friend/pet` is 200, and assert every dsh-Friend plugin printed
 * the official `dsh-friend:plugin-mount` line. Always kill the child (and its
 * process group) on
 * success, failure, or timeout — no orphan `dsh` processes.
 *
 * If `dsh` is not on PATH, print a clear skip message and exit 0. Pass
 * `--require-dsh` to make a missing CLI a hard failure (for a later CI job
 * that actually installs dsh).
 *
 * Playwright e2e (settings page shows a Friend card) is deferred to M1/M8.
 * There is no guaranteed real dsh environment in M0, so a browser spec would
 * be empty spinning. When a real environment exists:
 *   1. Reuse `parseListenAddress` / `waitForHttpOk` / the boot helper here
 *      (or start dsh once from Playwright `globalSetup`).
 *   2. Open the settings page in Chromium.
 *   3. Assert a visible "dsh-Friend" / Friend card.
 * Wire that spec into CI only after `node scripts/smoke.mjs --require-dsh`
 * is already green.
 *
 * Local pnpm without a TTY needs `export CI=true`
 * (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). GitHub Actions already sets
 * CI=true; workflows still pin it explicitly for `act` and similar.
 */
import { spawn } from 'node:child_process'
import { access, constants, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

import { DEFAULT_ROOT, runLinkProfile } from './link-profile.mjs'

export const DEFAULT_DSH_PORT = 3080
export const FRIEND_PET_PATH = '/friend/pet'
export const SMOKE_SKIP_MESSAGE = '未检测到 dsh CLI，跳过冒烟。安装 dsh 后重新运行 `node scripts/smoke.mjs`；CI 可用 `--require-dsh` 强制要求 CLI 存在。'

export const FRIEND_PACKAGES = Object.freeze([
  '@wishp3/dsh-friend-shared',
  '@wishp3/dsh-friend-persona',
  '@wishp3/dsh-friend-memory',
  '@wishp3/dsh-friend-tts',
  '@wishp3/dsh-friend-asr',
  '@wishp3/dsh-friend-stage',
  '@wishp3/dsh-friend-growth',
  '@wishp3/dsh-friend-reactions',
  '@wishp3/dsh-friend-settings',
  '@wishp3/dsh-friend-perception',
  '@wishp3/dsh-friend-all',
])

export const FRIEND_PRESET_IDS = Object.freeze([
  'friend-companion',
  'friend-companion-plus',
])

/**
 * Official line after host apply() `ctx.agentPresets.resolve(id)` succeeds.
 * Keep in lockstep with `packages/dsh-friend-persona/src/presets.ts`.
 *
 * rc.6 cannot list a preset's tools or prompt sections from outside the
 * process. Checked: `docs/m0-findings.md` §1 / §5; AgentPresets
 * (`list` / `resolve` / `read` / `standingKeyFor` — in-process only);
 * `dsh-tools` `get` / `schemas(scope)` (need a ScopeKey);
 * `dsh-system-prompt` `assemble()` (in-process); dsh CLI (no list-presets
 * / list-tools); `dsh-host-webserver` (no inspect HTTP); `cordis/inspect-query`
 * is a closed host-event name, not a smoke-callable API. Smoke therefore
 * asserts these resolve-success lines, not tool visibility.
 */
export const PRESET_READY_LOG_EVENT = 'dsh-friend:preset-ready'

export function usage() {
  return `Usage: node scripts/smoke.mjs [--require-dsh] [--use-user-home] [--port <n>] [--timeout-ms <n>]

  --require-dsh      Exit 1 when dsh is not on PATH (default: skip, exit 0)
  --use-user-home    Boot the real $DSH_HOME profile (default: isolated tmp home)
  --port <n>         Web port (default: a free loopback port, or 3080)
  --timeout-ms <n>   Ready timeout (default: 60000)

export CI=true before any pnpm install/build on this machine.`
}

export function parseArgs(argv) {
  let requireDsh = false
  let useUserHome = false
  let port
  let timeoutMs = 60_000
  let profile = 'web'

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--require-dsh') {
      requireDsh = true
      continue
    }
    if (arg === '--use-user-home') {
      useUserHome = true
      continue
    }
    if (arg === '--port') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--port requires a number')
      }
      port = Number(value)
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('--port must be an integer 1–65535')
      }
      index += 1
      continue
    }
    if (arg === '--timeout-ms') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--timeout-ms requires a number')
      }
      timeoutMs = Number(value)
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
        throw new Error('--timeout-ms must be a positive integer')
      }
      index += 1
      continue
    }
    if (arg === '--profile') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--profile requires a name')
      }
      profile = value
      index += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      return { help: true, requireDsh, useUserHome, port, timeoutMs, profile }
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return { help: false, requireDsh, useUserHome, port, timeoutMs, profile }
}

export function parseListenAddress(logText, fallbackPort = DEFAULT_DSH_PORT) {
  const url = logText.match(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d{2,5})\b/i)
  if (url) {
    const port = Number(url[1])
    return { host: '127.0.0.1', port, origin: `http://127.0.0.1:${port}` }
  }
  const labelled = logText.match(/\b(?:listening|listen|port)[:\s]+(?:on\s+)?(?:port\s+)?(\d{2,5})\b/i)
  if (labelled) {
    const port = Number(labelled[1])
    return { host: '127.0.0.1', port, origin: `http://127.0.0.1:${port}` }
  }
  if (Number.isInteger(fallbackPort) && fallbackPort > 0) {
    return { host: '127.0.0.1', port: fallbackPort, origin: `http://127.0.0.1:${fallbackPort}` }
  }
  return null
}

/**
 * Official mount line. Keep in lockstep with
 * `packages/dsh-friend-shared/src/plugin-mount.ts` — `scripts/smoke.test.ts`
 * asserts the two formatters emit the same string.
 */
export const PLUGIN_MOUNT_LOG_EVENT = 'dsh-friend:plugin-mount'

export function formatPluginMountLog(name) {
  return `${PLUGIN_MOUNT_LOG_EVENT} ${name}`
}

export function findMissingPluginMounts(logText, packageNames = FRIEND_PACKAGES) {
  return packageNames.filter((name) => {
    const short = name.replace(/^@[^/]+\//, '')
    return !logText.includes(formatPluginMountLog(name))
      && !logText.includes(formatPluginMountLog(short))
  })
}

export function formatPresetReadyLog(id) {
  return `${PRESET_READY_LOG_EVENT} ${id}`
}

export function findMissingPresetReady(logText, ids = FRIEND_PRESET_IDS) {
  const lines = logText.split(/\r?\n/)
  return ids.filter((id) => {
    const expected = formatPresetReadyLog(id)
    return !lines.some((line) => line.trim() === expected)
  })
}

export function assertPetOk(status) {
  if (status !== 200) {
    throw new Error(`expected GET ${FRIEND_PET_PATH} 200, got ${status}`)
  }
}

export function resolveSmokePlan(options) {
  const dshBin = options.dshBin
  const requireDsh = options.requireDsh === true
  if (!dshBin) {
    if (requireDsh) {
      return { action: 'fail', message: 'dsh CLI not found on PATH (--require-dsh).' }
    }
    return { action: 'skip', message: SMOKE_SKIP_MESSAGE }
  }
  return { action: 'run' }
}

export async function resolveDshBinary(env = process.env) {
  if (typeof env.DSH_BIN === 'string' && env.DSH_BIN.length > 0) {
    return env.DSH_BIN
  }
  const pathEnv = env.PATH ?? env.Path ?? ''
  for (const dir of pathEnv.split(delimiter)) {
    if (dir.length === 0) {
      continue
    }
    const candidate = join(dir, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // try next PATH entry
    }
  }
  return null
}

export async function waitUntil(predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5_000
  const intervalMs = options.intervalMs ?? 50
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      if (await predicate()) {
        return
      }
    } catch (error) {
      lastError = error
    }
    await delay(intervalMs)
  }
  throw lastError instanceof Error ? lastError : new Error(options.message ?? 'timed out waiting')
}

export async function waitForHttpOk(options) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  const intervalMs = options.intervalMs ?? 200
  const url = `${options.origin}${options.path}`
  let lastStatus
  await waitUntil(async () => {
    try {
      const response = await fetchImpl(url, { redirect: 'manual' })
      lastStatus = response.status
      if (options.acceptAnyResponse === true) {
        return true
      }
      return response.status === 200
    } catch (error) {
      lastStatus = undefined
      throw error
    }
  }, {
    timeoutMs,
    intervalMs,
    message: `timed out waiting for ${url}${lastStatus === undefined ? '' : ` (last status ${lastStatus})`}`,
  })
  return lastStatus
}

export function killProcessTree(pid, options = {}) {
  const kill = options.kill ?? process.kill
  const signal = options.signal ?? 'SIGTERM'
  if (!Number.isInteger(pid) || pid <= 0) {
    return
  }
  try {
    kill(-pid, signal)
  } catch {
    try {
      kill(pid, signal)
    } catch {
      // already gone
    }
  }
}

export function renderFriendOverlayPatch(packageNames = FRIEND_PACKAGES) {
  const rows = packageNames.map((name) => {
    const id = name.replace(/^@[^/]+\//, '')
    return `    - id: ${id}\n      name: '${name}'`
  })
  return `- insert:\n${rows.join('\n')}\n`
}

export async function pickFreePort() {
  const { createServer } = await import('node:net')
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : undefined
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        if (typeof port !== 'number') {
          reject(new Error('failed to allocate a free port'))
          return
        }
        resolvePort(port)
      })
    })
  })
}

function childEnv(base, extras) {
  return {
    ...base,
    CI: 'true',
    DSH_TELEMETRY_DISABLED: '1',
    BROWSER: 'true',
    ...extras,
  }
}

async function execDsh(dshBin, args, env) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  return execFileAsync(dshBin, args, {
    env,
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  })
}

export async function prepareIsolatedProfile(options) {
  const home = options.home
  const dshBin = options.dshBin
  const repoRoot = options.repoRoot
  const profile = options.profile ?? 'web'
  const env = childEnv(options.env ?? process.env, { DSH_HOME: home })

  await execDsh(dshBin, ['--profile', profile, '--dump-default-config'], env)

  const profileRoot = join(home, 'profiles', profile)
  const linked = await runLinkProfile({ repoRoot, profileRoot })
  if (!linked.ok) {
    throw new Error(`link-profile failed in isolated home:\n${[...linked.lines, ...linked.errors].join('\n')}`)
  }

  const overlayPath = join(home, 'friend-smoke.patch.yml')
  await writeFile(overlayPath, renderFriendOverlayPatch(), 'utf8')
  return { profileRoot, overlayPath, linkLines: linked.lines }
}

export async function runLiveSmoke(options) {
  const dshBin = options.dshBin
  const repoRoot = options.repoRoot ?? DEFAULT_ROOT
  const profile = options.profile ?? 'web'
  const timeoutMs = options.timeoutMs ?? 60_000
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const useUserHome = options.useUserHome === true
  const log = options.log ?? ((line) => console.error(line))

  const isolatedHome = useUserHome ? undefined : await mkdtemp(join(tmpdir(), 'dsh-friend-smoke-'))
  const port = options.port ?? await pickFreePort()
  const env = childEnv(options.env ?? process.env, isolatedHome === undefined ? {} : { DSH_HOME: isolatedHome })

  let overlayPath
  if (isolatedHome !== undefined) {
    log(`using isolated DSH_HOME=${isolatedHome} (will not touch ~/.dsh)`)
    const prepared = await prepareIsolatedProfile({
      home: isolatedHome,
      dshBin,
      repoRoot,
      profile,
      env,
    })
    overlayPath = prepared.overlayPath
    for (const line of prepared.linkLines) {
      log(line)
    }
  }

  const args = ['web']
  if (overlayPath !== undefined) {
    args.push('--patch', overlayPath)
  }
  args.push('--port', String(port))

  log(`starting: ${dshBin} ${args.join(' ')}`)

  const child = spawn(dshBin, args, {
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  const append = (chunk) => {
    const text = String(chunk)
    output += text
    log(text.replace(/\n$/, ''))
  }
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)

  let finished = false
  let exitCode
  child.on('exit', (code) => {
    exitCode = code
  })

  const pid = child.pid
  const stop = (signal = 'SIGTERM') => {
    if (typeof pid === 'number') {
      killProcessTree(pid, { signal })
    }
  }

  const onSignal = () => {
    stop('SIGTERM')
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  const onExit = () => {
    stop('SIGKILL')
  }
  process.once('exit', onExit)

  try {
    const origin = `http://127.0.0.1:${port}`
    const died = new Promise((_, reject) => {
      child.once('exit', (code) => {
        if (!finished) {
          reject(new Error(`dsh exited with code ${code} before becoming ready\n${output}`))
        }
      })
    })

    const petStatus = await Promise.race([
      waitForHttpOk({
        origin,
        path: FRIEND_PET_PATH,
        fetchImpl,
        timeoutMs,
        intervalMs: 250,
      }),
      died,
    ])
    finished = true
    if (exitCode !== undefined) {
      throw new Error(`dsh exited with code ${exitCode} before becoming ready\n${output}`)
    }
    assertPetOk(petStatus)

    const listen = parseListenAddress(output, port)
    if (listen === null) {
      throw new Error(`could not parse a listen address from dsh logs\n${output}`)
    }

    // GET /friend/pet 200 is a route-availability check, not stage mount proof.
    // Every package, including stage, must print the official mount line.
    //
    // stage can answer the route before the packages applied after it have
    // flushed their mount lines, so poll instead of reading `output` once.
    try {
      await waitUntil(() => findMissingPluginMounts(output).length === 0, {
        timeoutMs: Math.min(timeoutMs, 15_000),
        intervalMs: 50,
        message: 'startup logs missing plugin mounts',
      })
    } catch {
      const missing = findMissingPluginMounts(output)
      throw new Error(`startup logs missing plugin mounts: ${missing.join(', ')}\n${output}`)
    }

    // Host apply() publishes then resolve()s after stage may already have
    // answered GET /friend/pet. Wait for the explicit success lines — do not
    // treat "didn't crash" as proof the roster saw both presets.
    try {
      await waitUntil(() => findMissingPresetReady(output).length === 0, {
        timeoutMs: Math.min(timeoutMs, 15_000),
        intervalMs: 50,
        message: 'startup logs missing preset-ready',
      })
    } catch {
      const missingPresets = findMissingPresetReady(output)
      throw new Error(
        `startup logs missing preset-ready (resolve failed or skipped): ${missingPresets.join(', ')}\n${output}`,
      )
    }

    log(
      `smoke ok  GET ${origin}${FRIEND_PET_PATH} → 200  (${FRIEND_PACKAGES.length} plugins mounted; presets ready: ${FRIEND_PRESET_IDS.join(', ')})`,
    )
    return { ok: true, origin, output, port: listen.port }
  } finally {
    finished = true
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    process.removeListener('exit', onExit)
    stop('SIGTERM')
    await delay(300)
    stop('SIGKILL')
    try {
      if (isolatedHome !== undefined) {
        const { rm } = await import('node:fs/promises')
        await rm(isolatedHome, { recursive: true, force: true })
      }
    } catch {
      // temp dir cleanup is best-effort
    }
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      console.log(usage())
      return
    }

    const dshBin = await resolveDshBinary()
    const plan = resolveSmokePlan({ dshBin, requireDsh: options.requireDsh })
    if (plan.action === 'skip') {
      console.log(plan.message)
      return
    }
    if (plan.action === 'fail') {
      console.error(plan.message)
      process.exitCode = 1
      return
    }

    await runLiveSmoke({
      dshBin,
      repoRoot: DEFAULT_ROOT,
      profile: options.profile,
      port: options.port,
      timeoutMs: options.timeoutMs,
      useUserHome: options.useUserHome,
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

const invocation = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href
if (import.meta.url === invocation) {
  await main()
}
