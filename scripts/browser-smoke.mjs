#!/usr/bin/env node
/**
 * Browser-level client-half gate (decision L1 / L-A).
 *
 * Host smoke (`scripts/smoke.mjs`) can be all-green — 11
 * `dsh-friend:plugin-mount` lines, both `dsh-friend:preset-ready` lines,
 * `GET /friend/pet` 200 — while four client halves crash the real UI with
 * `Failed to load plugins`. This script opens the client root in Chromium
 * and fails when that happens, naming the package and the undeclared
 * property.
 *
 * Isolation matches `smoke.mjs`: temporary `DSH_HOME`, never `~/.dsh`.
 * Dependency is `playwright` (not `@playwright/test`, not `playwright-core`):
 * this is a standalone Node script, so the Test runner is unused;
 * `playwright-core` cannot `install` browsers. `playwright@1.62.1` gives
 * `chromium.launch()` plus `pnpm exec playwright install chromium`.
 * Browsers stay in the Playwright cache, never the repo.
 *
 * Default: skip (exit 0) when `dsh` or Chromium is missing.
 * CI: `node scripts/browser-smoke.mjs --require-dsh --require-browser`.
 *
 * Local pnpm without a TTY needs `export CI=true`.
 */
import { spawn } from 'node:child_process'
import { access, constants, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

import { DEFAULT_ROOT } from './link-profile.mjs'
import {
  FRIEND_PACKAGES,
  killProcessTree,
  parseListenAddress,
  pickFreePort,
  prepareIsolatedProfile,
  resolveDshBinary,
  waitForHttpOk,
  waitUntil,
} from './smoke.mjs'

export { FRIEND_PACKAGES }

/** Packages that ship a `dsh.client` half. `all` and `perception` are host-only. */
export const FRIEND_CLIENT_PACKAGES = Object.freeze([
  '@wishp3/dsh-friend-shared',
  '@wishp3/dsh-friend-persona',
  '@wishp3/dsh-friend-memory',
  '@wishp3/dsh-friend-tts',
  '@wishp3/dsh-friend-asr',
  '@wishp3/dsh-friend-stage',
  '@wishp3/dsh-friend-growth',
  '@wishp3/dsh-friend-reactions',
  '@wishp3/dsh-friend-settings',
])

export const FAILED_TO_LOAD_PLUGINS = 'Failed to load plugins'
export const LOADING_PLUGINS = 'Loading plugins…'

export const BROWSER_SMOKE_SKIP_NO_DSH = '未检测到 dsh CLI，跳过浏览器门禁。安装 dsh 后重新运行 `node scripts/browser-smoke.mjs`；CI 可用 `--require-dsh` 强制要求 CLI 存在。'
export const BROWSER_SMOKE_SKIP_NO_BROWSER = '未检测到 Playwright Chromium，跳过浏览器门禁。运行 `pnpm exec playwright install chromium` 后重试；CI 可用 `--require-browser` 强制要求浏览器存在。'

const LOADER_APPLY_ERROR_RE = /failed to apply loader entry \S+ \(([^)]+)\):\s*(.+)/
const MISSING_INJECT_PROPERTY_RE = /cannot get property "([^"]+)" without inject/

export function usage() {
  return `Usage: node scripts/browser-smoke.mjs [--require-dsh] [--require-browser] [--use-user-home] [--port <n>] [--timeout-ms <n>]

  --require-dsh       Exit 1 when dsh is not on PATH (default: skip, exit 0)
  --require-browser   Exit 1 when Playwright Chromium is missing (default: skip, exit 0)
  --use-user-home     Boot the real $DSH_HOME profile (default: isolated tmp home)
  --port <n>          Web port (default: a free loopback port)
  --timeout-ms <n>    Ready / page timeout (default: 60000)

Host mount lines and GET /friend/pet 200 are not client-half evidence.
export CI=true before any pnpm install/build on this machine.`
}

export function parseArgs(argv) {
  let requireDsh = false
  let requireBrowser = false
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
    if (arg === '--require-browser') {
      requireBrowser = true
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
      return { help: true, requireDsh, requireBrowser, useUserHome, port, timeoutMs, profile }
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return { help: false, requireDsh, requireBrowser, useUserHome, port, timeoutMs, profile }
}

export function resolveBrowserSmokePlan(options) {
  const requireDsh = options.requireDsh === true
  const requireBrowser = options.requireBrowser === true
  if (!options.dshBin) {
    if (requireDsh) {
      return { action: 'fail', message: 'dsh CLI not found on PATH (--require-dsh).' }
    }
    return { action: 'skip', message: BROWSER_SMOKE_SKIP_NO_DSH }
  }
  if (!options.browser) {
    if (requireBrowser) {
      return {
        action: 'fail',
        message: 'Playwright Chromium not found (--require-browser). Run `pnpm exec playwright install chromium`.',
      }
    }
    return { action: 'skip', message: BROWSER_SMOKE_SKIP_NO_BROWSER }
  }
  return { action: 'run' }
}

/**
 * Loading page vs fail-loud vs settled UI.
 * Isolated profiles show 内测声明 / API Key dialogs after a successful boot;
 * those dialogs are not a failure and must not be required to dismiss.
 */
export function classifyBootPage(pageText) {
  if (pageText.includes(FAILED_TO_LOAD_PLUGINS)) {
    return 'failed'
  }
  if (pageText.includes(LOADING_PLUGINS)) {
    return 'loading'
  }
  if (pageText.trim().length === 0) {
    return 'empty'
  }
  return 'settled'
}

export function parseClientLoadFailures(pageText) {
  if (!pageText.includes(FAILED_TO_LOAD_PLUGINS)) {
    return {
      failed: false,
      packages: [],
      applyError: null,
      property: null,
      namedPackage: null,
    }
  }

  const applyMatch = pageText.match(LOADER_APPLY_ERROR_RE)
  const applyError = applyMatch ? applyMatch[0].trim() : null
  const namedPackage = applyMatch?.[1] ?? null
  const detail = applyMatch?.[2] ?? ''
  const propertyMatch = detail.match(MISSING_INJECT_PROPERTY_RE)
  const property = propertyMatch?.[1] ?? null

  const after = pageText.slice(pageText.indexOf(FAILED_TO_LOAD_PLUGINS) + FAILED_TO_LOAD_PLUGINS.length)
  const packages = []
  for (const line of after.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }
    if (trimmed.startsWith('failed to apply') || trimmed.startsWith('web boot:')) {
      break
    }
    if (trimmed.startsWith('@') || /^dsh-friend-/.test(trimmed)) {
      packages.push(trimmed)
    }
  }
  if (namedPackage !== null && !packages.includes(namedPackage)) {
    packages.unshift(namedPackage)
  }

  return { failed: true, packages, applyError, property, namedPackage }
}

export function listBootEntryIds(boot) {
  if (boot === null || typeof boot !== 'object') {
    return []
  }
  const entries = 'entries' in boot ? boot.entries : undefined
  if (!Array.isArray(entries)) {
    return []
  }
  const ids = []
  for (const row of entries) {
    if (row === null || typeof row !== 'object') {
      continue
    }
    const id = 'id' in row ? row.id : undefined
    if (typeof id === 'string' && id.length > 0) {
      ids.push(id)
    }
  }
  return ids
}

export function formatClientLoadFailure(parsed) {
  const lines = ['client halves failed to load']
  if (parsed.packages.length > 0) {
    lines.push(`packages: ${parsed.packages.join(', ')}`)
  }
  if (parsed.namedPackage !== null && parsed.property !== null) {
    lines.push(`package: ${parsed.namedPackage}  property: ${parsed.property}`)
  } else if (parsed.property !== null) {
    lines.push(`property: ${parsed.property}`)
  }
  if (parsed.applyError !== null) {
    lines.push(parsed.applyError)
  }
  return lines.join('\n')
}

export function assertClientHalvesLoaded(input) {
  const pageText = input.pageText
  const expected = input.expectedPackages ?? FRIEND_CLIENT_PACKAGES
  const bootEntryIds = input.bootEntryIds ?? []

  const parsed = parseClientLoadFailures(pageText)
  if (parsed.failed) {
    throw new Error(formatClientLoadFailure(parsed))
  }

  if (classifyBootPage(pageText) !== 'settled') {
    throw new Error(`dsh client boot did not settle\n${pageText}`)
  }

  const missingFromBoot = expected.filter((name) => !bootEntryIds.includes(name))
  if (missingFromBoot.length > 0) {
    throw new Error(
      `client boot graph missing friend client halves: ${missingFromBoot.join(', ')}\nboot entries: ${bootEntryIds.join(', ') || '(none)'}`,
    )
  }
}

const DEFAULT_CURSOR = new Set(['auto', 'default', ''])
const RESIZE_HANDLES = Object.freeze(['top-left', 'top-right', 'bottom-left', 'bottom-right'])

export function formatClientRect(rect) {
  if (rect === null || typeof rect !== 'object') {
    return '(missing)'
  }
  const x = Number(rect.x ?? rect.left ?? 0)
  const y = Number(rect.y ?? rect.top ?? 0)
  const width = Number(rect.width ?? 0)
  const height = Number(rect.height ?? 0)
  return `[${roundPx(x)},${roundPx(y)},${roundPx(width)},${roundPx(height)}]`
}

export function isDefaultCursor(cursor) {
  return DEFAULT_CURSOR.has(String(cursor ?? '').trim().toLowerCase())
}

/**
 * Real-layout gate for the in-page float chrome.
 * Reads getBoundingClientRect + computed cursor — not host.style.cssText.
 * jsdom overlay tests cannot catch a 0-height drag bar or four handles in a row.
 */
export function assertFloatChromeGeometry(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') {
    throw new Error('float chrome geometry failed\nmissing snapshot')
  }
  if (typeof snapshot.missing === 'string' && snapshot.missing.length > 0) {
    throw new Error(`float chrome geometry failed\nmissing element: ${snapshot.missing}`)
  }

  const errors = []
  const viewport = snapshot.viewport ?? { width: 0, height: 0 }
  const host = snapshot.host
  const drag = snapshot.drag
  const handles = Array.isArray(snapshot.handles) ? snapshot.handles : []

  if (host === null || typeof host !== 'object' || host.rect === undefined) {
    errors.push('#dsh-friend-float: missing host box')
  } else {
    if (host.hidden === true) {
      errors.push(`#dsh-friend-float is hidden; rect=${formatClientRect(host.rect)}`)
    }
    if (host.rect.width <= 0 || host.rect.height <= 0) {
      errors.push(`#dsh-friend-float has no box: rect=${formatClientRect(host.rect)}`)
    }
    const inViewport = host.rect.right > 0
      && host.rect.left < viewport.width
      && host.rect.bottom > 0
      && host.rect.top < viewport.height
    if (!inViewport) {
      errors.push(
        `#dsh-friend-float is outside viewport ${viewport.width}x${viewport.height}: rect=${formatClientRect(host.rect)}`,
      )
    }
  }

  if (drag === null || typeof drag !== 'object' || drag.rect === undefined) {
    errors.push('.dsh-friend-float-drag: missing drag bar')
  } else {
    if (!(drag.height > 0) || !(drag.rect.height > 0)) {
      errors.push(
        `.dsh-friend-float-drag is not grabbable: height=${roundPx(drag.height ?? drag.rect.height)}px cursor=${drag.cursor} position=${drag.position} rect=${formatClientRect(drag.rect)}`,
      )
    }
    if (isDefaultCursor(drag.cursor)) {
      errors.push(
        `.dsh-friend-float-drag cursor is ${drag.cursor} (want grab/move); height=${roundPx(drag.height ?? 0)}px position=${drag.position} rect=${formatClientRect(drag.rect)}`,
      )
    }
  }

  const byName = new Map()
  for (const name of RESIZE_HANDLES) {
    const handle = handles.find((row) => row !== null && typeof row === 'object' && row.name === name)
    if (handle === undefined || handle.rect === undefined) {
      errors.push(`[data-resize="${name}"]: missing handle`)
      continue
    }
    byName.set(name, handle)
    if (handle.rect.width <= 0 || handle.rect.height <= 0) {
      errors.push(
        `[data-resize="${name}"] has no box: rect=${formatClientRect(handle.rect)} cursor=${handle.cursor} position=${handle.position}`,
      )
    }
    if (isDefaultCursor(handle.cursor)) {
      errors.push(
        `[data-resize="${name}"] cursor is ${handle.cursor} (want resize); rect=${formatClientRect(handle.rect)} position=${handle.position}`,
      )
    }
  }

  if (byName.size === RESIZE_HANDLES.length) {
    const tops = RESIZE_HANDLES.map((name) => byName.get(name).rect.y)
    if (sameLine(tops)) {
      errors.push(
        `resize handles share one horizontal line y≈${roundPx(tops[0])}: ${RESIZE_HANDLES.map((name) => {
          const handle = byName.get(name)
          return `${name} rect=${formatClientRect(handle.rect)} cursor=${handle.cursor} position=${handle.position}`
        }).join('; ')}`,
      )
    }
    const tl = byName.get('top-left')
    const tr = byName.get('top-right')
    const bl = byName.get('bottom-left')
    const br = byName.get('bottom-right')
    if (!aligned(tl.rect.y, tr.rect.y)) {
      errors.push(
        `resize top-left/top-right are not a top edge: top-left.y=${roundPx(tl.rect.y)} top-right.y=${roundPx(tr.rect.y)} rects ${formatClientRect(tl.rect)} ${formatClientRect(tr.rect)}`,
      )
    }
    if (!aligned(bl.rect.y, br.rect.y)) {
      errors.push(
        `resize bottom-left/bottom-right are not a bottom edge: bottom-left.y=${roundPx(bl.rect.y)} bottom-right.y=${roundPx(br.rect.y)} rects ${formatClientRect(bl.rect)} ${formatClientRect(br.rect)}`,
      )
    }
    if (!aligned(tl.rect.x, bl.rect.x)) {
      errors.push(
        `resize top-left/bottom-left are not a left edge: top-left.x=${roundPx(tl.rect.x)} bottom-left.x=${roundPx(bl.rect.x)} rects ${formatClientRect(tl.rect)} ${formatClientRect(bl.rect)}`,
      )
    }
    if (!aligned(tr.rect.x, br.rect.x)) {
      errors.push(
        `resize top-right/bottom-right are not a right edge: top-right.x=${roundPx(tr.rect.x)} bottom-right.x=${roundPx(br.rect.x)} rects ${formatClientRect(tr.rect)} ${formatClientRect(br.rect)}`,
      )
    }
    if (!(tl.rect.y < bl.rect.y - 1)) {
      errors.push(
        `resize top-left is not above bottom-left: top-left.y=${roundPx(tl.rect.y)} bottom-left.y=${roundPx(bl.rect.y)} rects ${formatClientRect(tl.rect)} ${formatClientRect(bl.rect)}`,
      )
    }
    if (!(tl.rect.x < tr.rect.x - 1)) {
      errors.push(
        `resize top-left is not left of top-right: top-left.x=${roundPx(tl.rect.x)} top-right.x=${roundPx(tr.rect.x)} rects ${formatClientRect(tl.rect)} ${formatClientRect(tr.rect)}`,
      )
    }
  }

  if (errors.length > 0) {
    throw new Error(`float chrome geometry failed\n${errors.join('\n')}`)
  }
}

export function formatFloatChromeGeometry(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object' || typeof snapshot.missing === 'string') {
    return `float chrome geometry: missing ${snapshot?.missing ?? 'snapshot'}`
  }
  const handles = Array.isArray(snapshot.handles) ? snapshot.handles : []
  const handleText = handles.map((handle) => (
    `${handle.name} rect=${formatClientRect(handle.rect)} cursor=${handle.cursor} position=${handle.position}`
  )).join('; ')
  return [
    `float chrome geometry ok  viewport=${snapshot.viewport?.width}x${snapshot.viewport?.height}`,
    `  host rect=${formatClientRect(snapshot.host?.rect)} hidden=${snapshot.host?.hidden}`,
    `  drag height=${roundPx(snapshot.drag?.height ?? 0)}px cursor=${snapshot.drag?.cursor} position=${snapshot.drag?.position} rect=${formatClientRect(snapshot.drag?.rect)}`,
    `  ${handleText}`,
  ].join('\n')
}

export async function readFloatChromeGeometry(page) {
  return page.evaluate((handleNames) => {
    const host = document.getElementById('dsh-friend-float')
    if (host === null) {
      return { missing: '#dsh-friend-float' }
    }
    const drag = host.querySelector('.dsh-friend-float-drag, [data-friend-drag]')
    if (drag === null) {
      return { missing: '.dsh-friend-float-drag' }
    }
    const handles = []
    for (const name of handleNames) {
      const node = host.querySelector(`[data-resize="${name}"]`)
      if (node === null) {
        return { missing: `[data-resize="${name}"]` }
      }
      handles.push(readBox(node, name))
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      host: { ...readBox(host, 'host'), hidden: host.hidden },
      drag: { ...readBox(drag, 'drag'), height: drag.getBoundingClientRect().height },
      handles,
    }

    function readBox(node, name) {
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return {
        name,
        cursor: style.cursor,
        position: style.position,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
      }
    }
  }, RESIZE_HANDLES)
}

function roundPx(value) {
  return Math.round(Number(value) * 10) / 10
}

function sameLine(values, tolerance = 1) {
  return Math.max(...values) - Math.min(...values) <= tolerance
}

function aligned(left, right, tolerance = 8) {
  return Math.abs(left - right) <= tolerance
}

export async function resolvePlaywrightBrowser() {
  try {
    const playwright = await import('playwright')
    const executablePath = playwright.chromium.executablePath()
    await access(executablePath, constants.X_OK)
    return { playwright, executablePath }
  } catch {
    return null
  }
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

export async function runBrowserSmoke(options) {
  const dshBin = options.dshBin
  const browserTooling = options.browser
  const repoRoot = options.repoRoot ?? DEFAULT_ROOT
  const profile = options.profile ?? 'web'
  const timeoutMs = options.timeoutMs ?? 60_000
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const useUserHome = options.useUserHome === true
  const log = options.log ?? ((line) => console.error(line))

  const isolatedHome = useUserHome ? undefined : await mkdtemp(join(tmpdir(), 'dsh-friend-browser-smoke-'))
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
  const stopDsh = (signal = 'SIGTERM') => {
    if (typeof pid === 'number') {
      killProcessTree(pid, { signal })
    }
  }

  let browser
  const stopBrowser = () => {
    if (browser === undefined) {
      return
    }
    const current = browser
    browser = undefined
    current.close().catch(() => {})
  }

  const onSignal = () => {
    stopBrowser('SIGTERM')
    stopDsh('SIGTERM')
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  const onExit = () => {
    stopBrowser('SIGKILL')
    stopDsh('SIGKILL')
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

    await Promise.race([
      waitForHttpOk({
        origin,
        path: '/',
        fetchImpl,
        timeoutMs,
        intervalMs: 250,
        acceptAnyResponse: true,
      }),
      died,
    ])
    finished = true
    if (exitCode !== undefined) {
      throw new Error(`dsh exited with code ${exitCode} before becoming ready\n${output}`)
    }

    const listen = parseListenAddress(output, port)
    const pageOrigin = listen?.origin ?? origin

    const launchArgs = process.env.CI === 'true'
      ? ['--no-sandbox', '--disable-dev-shm-usage']
      : []
    browser = await browserTooling.playwright.chromium.launch({
      executablePath: browserTooling.executablePath,
      headless: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      args: launchArgs,
    })

    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    const consoleLines = []
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleLines.push(message.text())
      }
    })
    page.on('pageerror', (error) => {
      consoleLines.push(error instanceof Error ? error.message : String(error))
    })

    await page.goto(pageOrigin, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    await waitUntil(async () => {
      const text = await page.locator('body').innerText().catch(() => '')
      const state = classifyBootPage(text)
      return state === 'failed' || state === 'settled'
    }, {
      timeoutMs,
      intervalMs: 200,
      message: `timed out waiting for dsh client boot to settle at ${pageOrigin}`,
    })

    const pageText = await page.locator('body').innerText()
    const boot = await page.evaluate(() => globalThis.__DSH_BOOT__)
    const bootEntryIds = listBootEntryIds(boot)

    try {
      assertClientHalvesLoaded({ pageText, bootEntryIds })
    } catch (error) {
      const extra = consoleLines.length > 0 ? `\nconsole:\n${consoleLines.join('\n')}` : ''
      throw new Error(`${error instanceof Error ? error.message : String(error)}${extra}`)
    }

    await waitUntil(async () => {
      const count = await page.locator('#dsh-friend-float').count()
      return count > 0
    }, {
      timeoutMs,
      intervalMs: 200,
      message: `timed out waiting for #dsh-friend-float at ${pageOrigin}`,
    })

    const floatChrome = await readFloatChromeGeometry(page)
    try {
      assertFloatChromeGeometry(floatChrome)
    } catch (error) {
      const extra = consoleLines.length > 0 ? `\nconsole:\n${consoleLines.join('\n')}` : ''
      throw new Error(`${error instanceof Error ? error.message : String(error)}${extra}`)
    }

    const snippet = pageText.replace(/\s+/g, ' ').trim().slice(0, 160)
    log(
      `browser-smoke ok  ${pageOrigin}  (${FRIEND_CLIENT_PACKAGES.length} client halves in boot graph; page has no "${FAILED_TO_LOAD_PLUGINS}")`,
    )
    log(`page snippet (dialogs are allowed): ${snippet}`)
    log(formatFloatChromeGeometry(floatChrome))
    return { ok: true, origin: pageOrigin, pageText, bootEntryIds, output, floatChrome }
  } finally {
    finished = true
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    process.removeListener('exit', onExit)
    stopBrowser('SIGTERM')
    stopDsh('SIGTERM')
    await delay(300)
    stopBrowser('SIGKILL')
    stopDsh('SIGKILL')
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
    const browser = await resolvePlaywrightBrowser()
    const plan = resolveBrowserSmokePlan({
      dshBin,
      browser,
      requireDsh: options.requireDsh,
      requireBrowser: options.requireBrowser,
    })
    if (plan.action === 'skip') {
      console.log(plan.message)
      return
    }
    if (plan.action === 'fail') {
      console.error(plan.message)
      process.exitCode = 1
      return
    }
    if (browser === null || dshBin === null) {
      console.error('browser-smoke: internal plan/run mismatch')
      process.exitCode = 1
      return
    }

    await runBrowserSmoke({
      dshBin,
      browser,
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
