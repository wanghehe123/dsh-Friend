import type { IncomingMessage, ServerResponse } from 'node:http'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { bindHostSettings, registerRoute, type FriendRouteContext } from '@wish233/dsh-friend-shared'

import { createAboutPayload, FRIEND_PACKAGE_VERSION } from './about.ts'
import { defaultPersonaCard, listCharacters, readPersonaCard, writePersonaCard } from './characters.ts'
import { buildZipStore, listExportEntries } from './export-zip.ts'
import { buildModelInheritViews, type HostModelViewsDeps } from './host-models.ts'
import { openDataDirectory, type SpawnLike } from './open-data-dir.ts'
import {
  FRIEND_SETTINGS_ABOUT_PATH,
  FRIEND_SETTINGS_CHARACTERS_PATH,
  FRIEND_SETTINGS_PERSONA_PATH,
  FRIEND_SETTINGS_EXPORT_PATH,
  FRIEND_SETTINGS_MODELS_PATH,
  FRIEND_SETTINGS_MODELS_TEST_PATH,
  FRIEND_SETTINGS_OPEN_DATA_DIR_PATH,
  FRIEND_SETTINGS_PATCH_PATH,
  FRIEND_SETTINGS_SHELL_PATH,
  FRIEND_SETTINGS_SNAPSHOT_PATH,
  FRIEND_SETTINGS_UPDATE_PATH,
  FRIEND_SHELL_HEARTBEAT_PATH,
} from './paths.ts'
import { asFriendHostSettings, parseSettingsPatch } from './patch.ts'
import { projectClientSettings, type SettingsReader } from './project.ts'
import type { SettingsSanitizeSeams } from './sanitize.ts'
import {
  parseShellHeartbeat,
  projectShellStatus,
  SHELL_HEARTBEAT_MAX_BYTES,
  type ShellHeartbeatStore,
} from './shell-heartbeat.ts'
import { checkForUpdate, type UpdateCheckFetch } from './update-check.ts'
import type { FriendModelPurpose } from './model-form.ts'

export type SettingsRouteDeps = {
  dataDir: string
  settings?: SettingsReader & {
    update?(namespace: string, patch: Record<string, unknown>): Promise<void>
  }
  seams?: SettingsSanitizeSeams
  models?: HostModelViewsDeps
  version?: string
  fetchImpl?: UpdateCheckFetch
  spawnImpl?: SpawnLike
  platform?: NodeJS.Platform
  /** @deprecated Prefer {@link shellHeartbeat}; kept for apply-option tests. */
  shellConnected?: () => boolean
  shellHeartbeat?: ShellHeartbeatStore
  testModel?: (purpose: FriendModelPurpose, override: string) => Promise<{ ok: boolean; detail: string }>
}

export function createSettingsRoutes(deps: SettingsRouteDeps): readonly WebRoute[] {
  const version = deps.version ?? FRIEND_PACKAGE_VERSION

  return [
    {
      kind: 'exact',
      path: FRIEND_SETTINGS_SNAPSHOT_PATH,
      async handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        writeJson(response, projectClientSettings(deps.settings, {
          ...(deps.seams !== undefined ? { seams: deps.seams } : {}),
        }))
      },
    },
    {
      kind: 'exact',
      path: FRIEND_SETTINGS_PATCH_PATH,
      async handler(request, response) {
        if (request.method !== 'POST') {
          return writeText(response, 'Method Not Allowed', 405)
        }
        let body: unknown
        try {
          body = await readJson(request)
        } catch {
          return writeJson(response, { ok: false, error: 'invalid json' }, 400)
        }
        const parsed = parseSettingsPatch(body)
        if (!parsed.ok) {
          return writeJson(response, { ok: false, error: parsed.error }, 400)
        }
        const live = asFriendHostSettings(deps.settings)
        if (live === undefined) {
          return writeJson(response, { ok: false, error: 'settings service unavailable' }, 503)
        }
        const settings = bindHostSettings(live)
        try {
          await settings.update(parsed.value.namespace, parsed.value.patch)
        } catch (error) {
          const message = error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'invalid patch'
          return writeJson(response, { ok: false, error: message }, 400)
        }
        writeJson(response, {
          ok: true,
          namespace: parsed.value.namespace,
          settings: projectClientSettings(settings, {
            ...(deps.seams !== undefined ? { seams: deps.seams } : {}),
          }),
        })
      },
    },
    {
      kind: 'exact',
      path: FRIEND_SETTINGS_CHARACTERS_PATH,
      async handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        writeJson(response, { characters: await listCharacters(deps.dataDir) })
      },
    },
    {
      kind: 'exact',
      path: FRIEND_SETTINGS_PERSONA_PATH,
      async handler(request, response) {
        if (isGet(request)) {
          try {
            const slug = queryValue(request, 'slug') ?? 'default'
            const card = await readPersonaCard(deps.dataDir, slug) ?? defaultPersonaCard(slug)
            return writeJson(response, { ok: true, persona: card })
          } catch (error) {
            return writeJson(response, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }, 400)
          }
        }
        if (request.method !== 'POST') {
          return writeText(response, 'Method Not Allowed', 405)
        }
        let body: unknown
        try {
          body = await readJson(request)
        } catch {
          return writeJson(response, { ok: false, error: 'invalid json' }, 400)
        }
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          return writeJson(response, { ok: false, error: 'persona is required' }, 400)
        }
        const record = body as Record<string, unknown>
        const slug = typeof record.slug === 'string' ? record.slug : queryValue(request, 'slug') ?? 'default'
        try {
          const persona = await writePersonaCard(deps.dataDir, slug, record)
          writeJson(response, { ok: true, persona })
        } catch (error) {
          writeJson(response, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }, 400)
        }
      },
    },
    {
      kind: 'exact',
      path: FRIEND_SETTINGS_MODELS_PATH,
      async handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        if (deps.models === undefined) {
          return writeJson(response, { views: [] })
        }
        writeJson(response, { views: await buildModelInheritViews(deps.models) })
      },
    },
    {
      kind: 'exact',
      path: FRIEND_SETTINGS_MODELS_TEST_PATH,
      async handler(request, response) {
        if (request.method !== 'POST') {
          return writeText(response, 'Method Not Allowed', 405)
        }
        const body = await readJson(request) as { purpose?: unknown; override?: unknown }
        const purpose = body.purpose
        if (purpose !== 'chat' && purpose !== 'summarize' && purpose !== 'growth') {
          return writeJson(response, { ok: false, error: 'purpose is required' }, 400)
        }
        const override = typeof body.override === 'string' ? body.override : ''
        if (deps.testModel !== undefined) {
          const result = await deps.testModel(purpose, override)
          return writeJson(response, { purpose, ...result })
        }
        writeJson(response, {
          purpose,
          ok: true,
          detail: override.trim().length === 0 ? 'inherit' : 'accepted',
        })
      },
    },
    {
      kind: 'exact',
      path: FRIEND_SETTINGS_EXPORT_PATH,
      async handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        const entries = await listExportEntries(deps.dataDir)
        const zip = buildZipStore(entries)
        response.statusCode = 200
        response.setHeader('content-type', 'application/zip')
        response.setHeader('content-disposition', 'attachment; filename="dsh-friend-export.zip"')
        response.setHeader('cache-control', 'no-store')
        response.end(Buffer.from(zip))
      },
    },
    {
      kind: 'exact',
      path: FRIEND_SETTINGS_OPEN_DATA_DIR_PATH,
      async handler(request, response) {
        if (request.method !== 'POST') {
          return writeText(response, 'Method Not Allowed', 405)
        }
        writeJson(response, openDataDirectory(
          deps.dataDir,
          deps.platform,
          deps.spawnImpl,
        ))
      },
    },
    {
      kind: 'exact',
      path: FRIEND_SETTINGS_UPDATE_PATH,
      async handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        writeJson(response, await checkForUpdate({
          current: version,
          ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
        }))
      },
    },
    {
      kind: 'exact',
      path: FRIEND_SETTINGS_ABOUT_PATH,
      async handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        writeJson(response, createAboutPayload(version))
      },
    },
    {
      kind: 'exact',
      path: FRIEND_SETTINGS_SHELL_PATH,
      async handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        const fromStore = projectShellStatus(deps.shellHeartbeat)
        const online = deps.shellConnected?.() === true || fromStore.online
        writeJson(response, {
          online,
          connected: online,
          downloadUrl: fromStore.downloadUrl,
        })
      },
    },
    {
      kind: 'exact',
      path: FRIEND_SHELL_HEARTBEAT_PATH,
      async handler(request, response) {
        if (request.method !== 'POST') {
          return writeText(response, 'Method Not Allowed', 405)
        }
        let body: unknown
        try {
          body = await readJson(request, SHELL_HEARTBEAT_MAX_BYTES)
        } catch {
          return writeJson(response, { ok: false, error: 'invalid json' }, 400)
        }
        const parsed = parseShellHeartbeat(body)
        if (!parsed.ok) {
          return writeJson(response, { ok: false, error: parsed.error }, 400)
        }
        deps.shellHeartbeat?.record(parsed.value)
        writeJson(response, { ok: true })
      },
    },
  ]
}

export function registerSettingsRoutes(ctx: FriendRouteContext, deps: SettingsRouteDeps): void {
  for (const route of createSettingsRoutes(deps)) {
    registerRoute(ctx, route)
  }
}

function isGet(request: IncomingMessage): boolean {
  return request.method === undefined || request.method === 'GET'
}

async function readJson(request: IncomingMessage, maxBytes = 1_000_000): Promise<unknown> {
  let body = ''
  for await (const chunk of request) {
    body += String(chunk)
    if (body.length > maxBytes) {
      throw new Error('request body is too large')
    }
  }
  if (body.trim().length === 0) {
    return {}
  }
  return JSON.parse(body) as unknown
}

function writeJson(response: ServerResponse, body: object, statusCode = 200): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}

function writeText(response: ServerResponse, body: string, statusCode: number): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.end(body)
}

function queryValue(request: IncomingMessage, key: string): string | undefined {
  const url = request.url
  if (typeof url !== 'string' || !url.includes('?')) {
    return undefined
  }
  const query = url.slice(url.indexOf('?') + 1)
  const params = new URLSearchParams(query)
  const value = params.get(key)
  return value === null || value.trim().length === 0 ? undefined : value.trim()
}
