import { FRIEND_GITHUB_RELEASES_PAGE } from './github-repo.ts'

/**
 * Local desktop-shell heartbeats should arrive every ~15–30 s.
 * 90 s is three missed 30 s beats: enough to survive a brief stall
 * (GC, sleep/wake, debugger) without flickering offline, but short
 * enough that a quit or crashed shell disappears from the config
 * center within a minute and a half. This is a localhost pet, not a
 * WAN agent — a 5-minute window would lie about "connected".
 */
export const SHELL_ONLINE_WINDOW_MS = 90_000

export const SHELL_HEARTBEAT_MAX_BYTES = 4_096

export const SHELL_PLATFORMS = ['darwin', 'win32', 'linux'] as const

export type ShellPlatform = (typeof SHELL_PLATFORMS)[number]

export type ShellHeartbeatInput = {
  version: string
  platform: ShellPlatform
  pid: number
}

export type ShellHeartbeatRecord = {
  receivedAt: number
  version: string
  platform: ShellPlatform
  pid: number
}

export type ParseShellHeartbeatResult =
  | { ok: true; value: ShellHeartbeatInput }
  | { ok: false; error: string }

/** Client-readable shell pane. Must never include pid / version / platform. */
export type ClientShellStatus = {
  online: boolean
  connected: boolean
  downloadUrl: string
}

const VERSION_MAX = 64
const VERSION_PATTERN = /^[A-Za-z0-9._+-]+$/
const PID_MAX = 2_147_483_647

export function isShellPlatform(value: unknown): value is ShellPlatform {
  return value === 'darwin' || value === 'win32' || value === 'linux'
}

export function parseShellHeartbeat(body: unknown): ParseShellHeartbeatResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'body must be a JSON object' }
  }
  const record = body as Record<string, unknown>
  const version = record.version
  if (typeof version !== 'string') {
    return { ok: false, error: 'version must be a string' }
  }
  const trimmed = version.trim()
  if (trimmed.length === 0 || trimmed.length > VERSION_MAX || !VERSION_PATTERN.test(trimmed)) {
    return { ok: false, error: 'version is invalid' }
  }
  if (!isShellPlatform(record.platform)) {
    return { ok: false, error: 'platform must be darwin, win32, or linux' }
  }
  const pid = record.pid
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid < 1 || pid > PID_MAX) {
    return { ok: false, error: 'pid must be a positive integer' }
  }
  return {
    ok: true,
    value: {
      version: trimmed,
      platform: record.platform,
      pid,
    },
  }
}

export type ShellHeartbeatStore = {
  record(input: ShellHeartbeatInput, at?: number): void
  isOnline(at?: number): boolean
  /** Host-only last beat. Never project this object to a client. */
  last(): ShellHeartbeatRecord | undefined
}

export type CreateShellHeartbeatStoreOptions = {
  now?: () => number
  windowMs?: number
}

export function createShellHeartbeatStore(
  options: CreateShellHeartbeatStoreOptions = {},
): ShellHeartbeatStore {
  const now = options.now ?? Date.now
  const windowMs = options.windowMs ?? SHELL_ONLINE_WINDOW_MS
  let last: ShellHeartbeatRecord | undefined
  return {
    record(input, at) {
      last = {
        receivedAt: at ?? now(),
        version: input.version,
        platform: input.platform,
        pid: input.pid,
      }
    },
    isOnline(at) {
      if (last === undefined) {
        return false
      }
      return (at ?? now()) - last.receivedAt <= windowMs
    },
    last() {
      return last === undefined ? undefined : { ...last }
    },
  }
}

export function projectShellStatus(
  store: ShellHeartbeatStore | undefined,
  at?: number,
): ClientShellStatus {
  const online = store?.isOnline(at) === true
  return {
    online,
    connected: online,
    downloadUrl: FRIEND_GITHUB_RELEASES_PAGE,
  }
}

export function readClientShellStatus(body: unknown): ClientShellStatus {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      online: false,
      connected: false,
      downloadUrl: FRIEND_GITHUB_RELEASES_PAGE,
    }
  }
  const record = body as Record<string, unknown>
  const online = record.online === true || record.connected === true
  const downloadUrl = typeof record.downloadUrl === 'string' && record.downloadUrl.startsWith('https://')
    ? record.downloadUrl
    : FRIEND_GITHUB_RELEASES_PAGE
  return { online, connected: online, downloadUrl }
}
