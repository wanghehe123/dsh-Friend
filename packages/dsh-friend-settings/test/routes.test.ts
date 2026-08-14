import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FRIEND_SETTINGS_NAMESPACES } from '@wish233/dsh-friend-shared/universal'
import { describe, expect, it } from 'vitest'

import {
  FRIEND_SETTINGS_ABOUT_PATH,
  FRIEND_SETTINGS_CHARACTERS_PATH,
  FRIEND_SETTINGS_PERSONA_PATH,
  FRIEND_SETTINGS_EXPORT_PATH,
  FRIEND_SETTINGS_MODELS_TEST_PATH,
  FRIEND_SETTINGS_OPEN_DATA_DIR_PATH,
  FRIEND_SETTINGS_PATCH_PATH,
  FRIEND_SETTINGS_SHELL_PATH,
  FRIEND_SETTINGS_SNAPSHOT_PATH,
  FRIEND_SETTINGS_UPDATE_PATH,
  FRIEND_SHELL_HEARTBEAT_PATH,
} from '../src/paths.ts'
import { createSettingsRoutes } from '../src/routes.ts'
import { createShellHeartbeatStore } from '../src/shell-heartbeat.ts'
import { FRIEND_GITHUB_RELEASES_PAGE } from '../src/github-repo.ts'
import { zipEntryNames } from '../src/export-zip.ts'

type FakeResponse = {
  statusCode: number
  headers: Record<string, string>
  body: string | Buffer
  setHeader: (name: string, value: string) => void
  end: (body?: string | Buffer) => void
}

function createResponse(): FakeResponse {
  const response: FakeResponse = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(body = '') {
      this.body = body
    },
  }
  return response
}

function route(path: string, deps: Parameters<typeof createSettingsRoutes>[0]) {
  const found = createSettingsRoutes(deps).find((item) => item.path === path)
  if (found === undefined) {
    throw new Error(`missing route ${path}`)
  }
  return found
}

describe('settings host routes', () => {
  it('rejects the wrong method and serves a sanitized snapshot', async () => {
    const canary = 'sk-live-CANARY_dsh_friend_settings_route_aa11'
    const deps = {
      dataDir: join(tmpdir(), 'missing-friend-data'),
      settings: {
        get(namespace: string) {
          if (namespace === FRIEND_SETTINGS_NAMESPACES.tts) {
            return { provider: 'openai-compat', openaiApiKey: canary }
          }
          return {}
        },
      },
    }
    const denied = createResponse()
    await route(FRIEND_SETTINGS_SNAPSHOT_PATH, deps).handler(
      { method: 'POST', url: FRIEND_SETTINGS_SNAPSHOT_PATH } as never,
      denied as never,
    )
    expect(denied.statusCode).toBe(405)

    const ok = createResponse()
    await route(FRIEND_SETTINGS_SNAPSHOT_PATH, deps).handler(
      { method: 'GET', url: FRIEND_SETTINGS_SNAPSHOT_PATH } as never,
      ok as never,
    )
    expect(ok.statusCode).toBe(200)
    expect(String(ok.body)).not.toContain(canary)
    expect(String(ok.body)).toContain('"hasApiKey":true')
  })

  it('lists characters, about notices, and export contents', async () => {
    const dataDir = join(tmpdir(), `dsh-friend-settings-routes-${Date.now()}`)
    await mkdir(join(dataDir, 'characters', 'default'), { recursive: true })
    await writeFile(join(dataDir, 'characters', 'default', 'persona.json'), '{"name":"小友"}')
    await writeFile(join(dataDir, 'characters', 'default', 'MEMORY.md'), 'fact')
    const deps = { dataDir }

    const characters = createResponse()
    await route(FRIEND_SETTINGS_CHARACTERS_PATH, deps).handler(
      { method: 'GET', url: FRIEND_SETTINGS_CHARACTERS_PATH } as never,
      characters as never,
    )
    expect(String(characters.body)).toContain('小友')

    const about = createResponse()
    await route(FRIEND_SETTINGS_ABOUT_PATH, deps).handler(
      { method: 'GET', url: FRIEND_SETTINGS_ABOUT_PATH } as never,
      about as never,
    )
    expect(String(about.body)).toContain('Kokoro Engine')
    expect(String(about.body)).toContain('Cubism')

    const exported = createResponse()
    await route(FRIEND_SETTINGS_EXPORT_PATH, deps).handler(
      { method: 'GET', url: FRIEND_SETTINGS_EXPORT_PATH } as never,
      exported as never,
    )
    expect(exported.headers['content-type']).toBe('application/zip')
    const names = zipEntryNames(new Uint8Array(exported.body as Buffer))
    expect(names.some((name) => name.endsWith('MEMORY.md'))).toBe(true)

    const persona = createResponse()
    await route(FRIEND_SETTINGS_PERSONA_PATH, deps).handler(
      { method: 'GET', url: `${FRIEND_SETTINGS_PERSONA_PATH}?slug=default` } as never,
      persona as never,
    )
    expect(persona.statusCode).toBe(200)
    expect(JSON.parse(String(persona.body))).toMatchObject({
      ok: true,
      persona: { slug: 'default', name: '小友' },
    })

    const missing = createResponse()
    await route(FRIEND_SETTINGS_PERSONA_PATH, deps).handler(
      { method: 'GET', url: `${FRIEND_SETTINGS_PERSONA_PATH}?slug=alt` } as never,
      missing as never,
    )
    expect(missing.statusCode).toBe(200)
    expect(JSON.parse(String(missing.body))).toMatchObject({
      ok: true,
      persona: { slug: 'alt', name: 'alt' },
    })

    const written = createResponse()
    await route(FRIEND_SETTINGS_PERSONA_PATH, deps).handler(
      {
        method: 'POST',
        url: FRIEND_SETTINGS_PERSONA_PATH,
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify({
            slug: 'alt',
            name: '阿特',
            personality: '干脆',
            greetings: ['嗨'],
          }))
        },
      } as never,
      written as never,
    )
    expect(written.statusCode).toBe(200)
    expect(JSON.parse(String(written.body))).toMatchObject({
      ok: true,
      persona: { slug: 'alt', name: '阿特', personality: '干脆', greetings: ['嗨'] },
    })

    const illegal = createResponse()
    await route(FRIEND_SETTINGS_PERSONA_PATH, deps).handler(
      { method: 'GET', url: `${FRIEND_SETTINGS_PERSONA_PATH}?slug=../etc` } as never,
      illegal as never,
    )
    expect(illegal.statusCode).toBe(400)
  })

  it('opens the data directory through an injected spawn and tests a model override', async () => {
    const spawned: Array<{ command: string; args: readonly string[] }> = []
    const deps = {
      dataDir: '/tmp/friend-data',
      platform: 'darwin' as const,
      spawnImpl: (command: string, args: readonly string[]) => {
        spawned.push({ command, args })
        return { unref() {} }
      },
      testModel: async () => ({ ok: true, detail: 'pong' }),
    }

    const opened = createResponse()
    await route(FRIEND_SETTINGS_OPEN_DATA_DIR_PATH, deps).handler(
      { method: 'POST', url: FRIEND_SETTINGS_OPEN_DATA_DIR_PATH } as never,
      opened as never,
    )
    expect(spawned).toEqual([{ command: 'open', args: ['/tmp/friend-data'] }])

    const tested = createResponse()
    const request = {
      method: 'POST',
      url: FRIEND_SETTINGS_MODELS_TEST_PATH,
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({ purpose: 'chat', override: 'deepseek-chat' }))
      },
    }
    await route(FRIEND_SETTINGS_MODELS_TEST_PATH, deps).handler(request as never, tested as never)
    expect(String(tested.body)).toContain('pong')

    const update = createResponse()
    await route(FRIEND_SETTINGS_UPDATE_PATH, {
      ...deps,
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return { tag_name: 'v0.1.0' }
        },
      }),
    }).handler({ method: 'GET', url: FRIEND_SETTINGS_UPDATE_PATH } as never, update as never)
    expect(String(update.body)).toContain('"status":"latest"')
  })

  it('accepts a validated shell heartbeat and exposes only online + download on GET', async () => {
    const canary = 'sk-live-CANARY_dsh_friend_settings_heartbeat_bb22'
    const store = createShellHeartbeatStore({ now: () => 1_000 })
    const deps = {
      dataDir: join(tmpdir(), 'missing-friend-data'),
      shellHeartbeat: store,
    }

    const denied = createResponse()
    await route(FRIEND_SHELL_HEARTBEAT_PATH, deps).handler(
      { method: 'GET', url: FRIEND_SHELL_HEARTBEAT_PATH } as never,
      denied as never,
    )
    expect(denied.statusCode).toBe(405)

    const bad = createResponse()
    await route(FRIEND_SHELL_HEARTBEAT_PATH, deps).handler(
      {
        method: 'POST',
        url: FRIEND_SHELL_HEARTBEAT_PATH,
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify({ version: canary, platform: 'beos', pid: 1 }))
        },
      } as never,
      bad as never,
    )
    expect(bad.statusCode).toBe(400)
    expect(store.isOnline()).toBe(false)

    const ok = createResponse()
    await route(FRIEND_SHELL_HEARTBEAT_PATH, deps).handler(
      {
        method: 'POST',
        url: FRIEND_SHELL_HEARTBEAT_PATH,
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify({
            version: canary,
            platform: 'darwin',
            pid: 4321,
            token: canary,
          }))
        },
      } as never,
      ok as never,
    )
    expect(ok.statusCode).toBe(200)
    expect(String(ok.body)).toBe('{"ok":true}')
    expect(String(ok.body)).not.toContain(canary)

    const status = createResponse()
    await route(FRIEND_SETTINGS_SHELL_PATH, deps).handler(
      { method: 'GET', url: FRIEND_SETTINGS_SHELL_PATH } as never,
      status as never,
    )
    expect(status.statusCode).toBe(200)
    expect(JSON.parse(String(status.body))).toEqual({
      online: true,
      connected: true,
      downloadUrl: FRIEND_GITHUB_RELEASES_PAGE,
    })
    expect(String(status.body)).not.toContain(canary)
    expect(String(status.body)).not.toContain('4321')
    expect(String(status.body)).not.toContain('darwin')

    const snapshot = createResponse()
    await route(FRIEND_SETTINGS_SNAPSHOT_PATH, deps).handler(
      { method: 'GET', url: FRIEND_SETTINGS_SNAPSHOT_PATH } as never,
      snapshot as never,
    )
    expect(String(snapshot.body)).not.toContain(canary)
    expect(String(snapshot.body)).not.toContain('4321')
    expect(String(snapshot.body)).not.toContain('/friend/shell/heartbeat')
  })

  it('patches a registered namespace through bindHostSettings so this.write stays bound', async () => {
    const canary = 'sk-live-CANARY_dsh_friend_settings_patch_cc33'
    class FakeSettings {
      readonly sections: Record<string, Record<string, unknown>> = {
        [FRIEND_SETTINGS_NAMESPACES.asr]: { hotkey: 'Alt+S', language: 'zh-CN' },
        [FRIEND_SETTINGS_NAMESPACES.tts]: { provider: 'openai-compat' },
      }

      get(namespace: string): unknown {
        return this.sections[namespace] ?? {}
      }

      async update(namespace: string, patch: Record<string, unknown>): Promise<void> {
        await this.write(namespace, patch)
      }

      private async write(namespace: string, patch: Record<string, unknown>): Promise<void> {
        this.sections[namespace] = { ...this.sections[namespace], ...patch }
      }
    }

    const settings = new FakeSettings()
    const deps = {
      dataDir: join(tmpdir(), 'missing-friend-data'),
      settings,
    }

    const denied = createResponse()
    await route(FRIEND_SETTINGS_PATCH_PATH, deps).handler(
      { method: 'GET', url: FRIEND_SETTINGS_PATCH_PATH } as never,
      denied as never,
    )
    expect(denied.statusCode).toBe(405)

    const unknown = createResponse()
    await route(FRIEND_SETTINGS_PATCH_PATH, deps).handler(
      {
        method: 'POST',
        url: FRIEND_SETTINGS_PATCH_PATH,
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify({ namespace: 'friend.asr', patch: { hotkey: 'Alt+Q' } }))
        },
      } as never,
      unknown as never,
    )
    expect(unknown.statusCode).toBe(400)
    expect(String(unknown.body)).toContain('unknown namespace')

    const illegal = createResponse()
    await route(FRIEND_SETTINGS_PATCH_PATH, deps).handler(
      {
        method: 'POST',
        url: FRIEND_SETTINGS_PATCH_PATH,
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify({ namespace: FRIEND_SETTINGS_NAMESPACES.asr, patch: null }))
        },
      } as never,
      illegal as never,
    )
    expect(illegal.statusCode).toBe(400)

    const secret = createResponse()
    await route(FRIEND_SETTINGS_PATCH_PATH, deps).handler(
      {
        method: 'POST',
        url: FRIEND_SETTINGS_PATCH_PATH,
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify({
            namespace: FRIEND_SETTINGS_NAMESPACES.tts,
            patch: { openaiApiKey: canary, voice: 'alloy' },
          }))
        },
      } as never,
      secret as never,
    )
    expect(secret.statusCode).toBe(200)
    expect(String(secret.body)).not.toContain(canary)
    expect(String(secret.body)).toContain('"hasApiKey":true')
    expect(settings.sections[FRIEND_SETTINGS_NAMESPACES.tts]).toMatchObject({
      openaiApiKey: canary,
      voice: 'alloy',
    })

    const patched = createResponse()
    await route(FRIEND_SETTINGS_PATCH_PATH, deps).handler(
      {
        method: 'POST',
        url: FRIEND_SETTINGS_PATCH_PATH,
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify({
            namespace: FRIEND_SETTINGS_NAMESPACES.asr,
            patch: { hotkey: 'Alt+Q', language: 'en-US' },
          }))
        },
      } as never,
      patched as never,
    )
    expect(patched.statusCode).toBe(200)
    expect(JSON.parse(String(patched.body)).settings.asr).toMatchObject({
      hotkey: 'Alt+Q',
      language: 'en-US',
    })
    expect(settings.sections[FRIEND_SETTINGS_NAMESPACES.asr]).toMatchObject({
      hotkey: 'Alt+Q',
      language: 'en-US',
    })
  })

  it('returns 4xx when settings.update rejects instead of 500', async () => {
    const deps = {
      dataDir: join(tmpdir(), 'missing-friend-data'),
      settings: {
        get() {
          return {}
        },
        async update() {
          throw new Error('schema rejected language')
        },
      },
    }
    const failed = createResponse()
    await route(FRIEND_SETTINGS_PATCH_PATH, deps).handler(
      {
        method: 'POST',
        url: FRIEND_SETTINGS_PATCH_PATH,
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify({
            namespace: FRIEND_SETTINGS_NAMESPACES.asr,
            patch: { language: 1 },
          }))
        },
      } as never,
      failed as never,
    )
    expect(failed.statusCode).toBe(400)
    expect(String(failed.body)).toContain('schema rejected language')
  })
})
