import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { extname } from 'node:path'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  FRIEND_EVENTS_PATH,
  FRIEND_SETTINGS_NAMESPACES,
  bindHostSettings,
  logPluginMount,
  pushToClient,
  registerFriendSettings,
  registerRoute,
  resolveFriendDataDir,
  type FriendAgentRegistry,
  type FriendRouteContext,
  type FriendToolContext,
} from '@wishp3/dsh-friend-shared'

import {
  createCompanionSessionFilter,
  createSettingsSessionIdStore,
  subscribeCompanionReplies,
  wrapContextSessionEvents,
  type SessionEventSource,
} from '@wishp3/dsh-friend-persona'

import { createChatRoutes } from './chat-routes.ts'
import { createChatTracker, getSharedChatTracker, type ChatTracker } from './chat-state.ts'
import { bindPersonaSend, type CompanionReplyWatch, type CompanionSend, type CompanionSendContext } from './companion-send.ts'
import { createCompanionStageSink } from './reply-bridge.ts'
import { createModelRoutes } from './model-routes.ts'
import {
  pendingBuiltinNailongInstall,
  readFriendMap,
  resolveCurrentModel,
  scheduleBuiltinNailongInstall,
  type InstalledModel,
} from './models.ts'
import type { FriendModelMap } from './model-map.ts'

import { resolveFriendAssetPath } from './live2d/asset-layout.ts'
import {
  createAssetProgressTracker,
  type AssetProgressSnapshot,
  type AssetProgressTracker,
} from './live2d/asset-progress.ts'
import { installOfficialLive2DAssets, type Live2DInstallResult } from './live2d/asset-installer.ts'
import {
  inspectLive2DAssets,
  type Live2DAssetStatus,
} from './live2d/asset-store.ts'
import { readCoreEnabled } from './core-gate.ts'
import { LIVE2D_TARGET_FPS } from './live2d/performance.ts'
import { readStageTargetFps } from './live2d/stage-settings.ts'
import {
  createFriendStageSettingsSchema,
  DEFAULT_STAGE_SETTINGS_ENTRY,
} from './settings-schema.ts'
import {
  createPerformanceTracker,
  getSharedPerformanceTracker,
  type PerformanceSnapshot,
  type PerformanceTracker,
} from './performance-state.ts'
import { registerPerformanceTools } from './tools.ts'

export { resolveWorkCue, type StageCue, type WorkSignal } from './work-cue.ts'
export { installOfficialLive2DAssets } from './live2d/asset-installer.ts'
export { inspectLive2DAssets, resolveFriendDataRoot, type Live2DAssetStatus } from './live2d/asset-store.ts'
export {
  createAssetProgressSnapshot,
  createAssetProgressTracker,
  IDLE_ASSET_PROGRESS,
  type AssetProgressSnapshot,
} from './live2d/asset-progress.ts'
export {
  MAX_STAGE_TAG_LENGTH,
  StreamingTagParser,
  classifyClosedStageTag,
  concatTagParseDeltas,
  parseStageTags,
  type StageTagEvent,
  type TagParseDelta,
} from './tag-parser.ts'
export {
  IDLE_PERFORMANCE,
  applyStageTagEvents,
  createPerformanceTracker,
  getSharedPerformanceTracker,
  resetSharedPerformanceTracker,
  type PerformanceSnapshot,
  type PerformanceTracker,
} from './performance-state.ts'
export {
  STAGE_TOOL_NAMES,
  createPerformanceTools,
  registerPerformanceTools,
} from './tools.ts'
export {
  BUILTIN_HIYORI_NAME,
  BUILTIN_NAILONG_LABEL,
  BUILTIN_NAILONG_NAME,
  HIYORI_DEFAULT_MAP,
  MAX_MODEL_ZIP_BYTES,
  NAILONG_DEFAULT_MAP,
  deleteUserModel,
  ensureBuiltinNailong,
  readModelCatalog,
  resolveBundledNailongZip,
  resolveCurrentModel,
  scheduleBuiltinNailongInstall,
  selectCurrentModel,
  uploadModelZip,
} from './models.ts'
export { generateDefaultFriendMap, parseModel3Json } from './model-map.ts'
export { createChatTracker, getSharedChatTracker, IDLE_CHAT, type ChatSnapshot } from './chat-state.ts'
export { bindPersonaSend, bindPersonaWatch, type CompanionSend } from './companion-send.ts'
export { createCompanionStageSink, type CompanionStageSink } from './reply-bridge.ts'
export { hitTestDrawables, pointInTriangle } from './hit-test.ts'
export { createSseClient } from './sse-client.ts'
export { createBubbleController } from './bubble.ts'
export {
  applyCornerResize,
  applyPointerDrag,
  chooseAvoidingCorner,
  detectDshPet,
} from './float-stage.ts'

export const name = '@wishp3/dsh-friend-stage'
export const inject = [
  'webServer',
  'tools',
  'settings',
  'agents',
  'agentDefaultModel',
  'agentPresets',
] as const
export const FRIEND_STAGE_RUNTIME_PATH = '/friend/stage/runtime'

export type StageApplyRole = 'host' | 'companion-preset'

export type StageApplyContext = {
  webServer?: FriendRouteContext['webServer']
  effect?: FriendRouteContext['effect']
  tools?: FriendToolContext['tools']
  settings?: {
    get(namespace: string): unknown
    update?(namespace: string, patch: Record<string, unknown>): Promise<void>
  }
  agents?: FriendAgentRegistry
  agentDefaultModel?: CompanionSendContext['agentDefaultModel']
  agentPresets?: CompanionSendContext['agentPresets']
  /**
   * Cordis `Context.on`. Not a service — do not add it to `inject`.
   * Official: `ctx.on('session/event', …)` (`@deepseek-ai/dsh-session`).
   */
  on?: (event: string, handler: (...args: unknown[]) => unknown) => unknown
}

export type StageApplyOptions = Readonly<{
  role?: StageApplyRole
  performanceTracker?: PerformanceTracker
  chatTracker?: ChatTracker
  sendCompanion?: CompanionSend
  watchCompanion?: CompanionReplyWatch
  replySource?: SessionEventSource
}>

export type StageAssetStore = Readonly<{
  inspect: () => Promise<Live2DAssetStatus>
  install: (licenseAccepted: boolean) => Promise<Live2DAssetStatus>
}>

export type StageRouteOptions = Readonly<{
  dataRoot?: string
  assetStore?: StageAssetStore
  /** Test seam; production resolves `lib/pet.js` adjacent to this host entry. */
  petBundlePath?: string
  resolveTargetFps?: () => number
  resolveCoreEnabled?: () => boolean
  progressTracker?: AssetProgressTracker
  performanceTracker?: PerformanceTracker
  chatTracker?: ChatTracker
  sendCompanion?: CompanionSend
  watchCompanion?: CompanionReplyWatch
  resolveCurrentModel?: () => Promise<InstalledModel>
  maxModelBytes?: number
}>

function writeHtml(response: ServerResponse, body: string, statusCode = 200): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(body)
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
  response.setHeader('cache-control', 'no-store')
  response.end(body)
}

function isTransparentRequest(request: IncomingMessage): boolean {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  return url.searchParams.get('transparent') === '1'
}

function isEmbedRequest(request: IncomingMessage): boolean {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  return url.searchParams.get('embed') === '1'
}

function isGet(request: IncomingMessage): boolean {
  return request.method === undefined || request.method === 'GET'
}

function createDefaultAssetStore(dataRoot: string, tracker: AssetProgressTracker): StageAssetStore {
  return {
    inspect: () => inspectLive2DAssets(dataRoot),
    install: (licenseAccepted) => installOfficialLive2DAssets({
      dataRoot,
      licenseAccepted,
      onProgress: (snapshot) => {
        tracker.set(snapshot)
      },
    }),
  }
}

/**
 * Standalone companion viewer. It deliberately loads the local official Core
 * before the bundle and loads Hiyori only from `/friend/assets`, never from a
 * package/npm asset path.
 */
export function renderPetPage(
  transparent: boolean,
  assets: Pick<Live2DAssetStatus, 'ready' | 'missing'>,
  targetFps: number = LIVE2D_TARGET_FPS,
  options: Readonly<{ embed?: boolean; modelUrl?: string; map?: FriendModelMap }> = {},
): string {
  const state = assets.ready ? 'ready' : 'missing'
  const embed = options.embed === true
  const content = assets.ready
    ? renderReadyViewer(targetFps, options.modelUrl, embed, options.map)
    : renderInstaller(assets.missing)

  return `<!doctype html>
<html lang="zh-CN" data-transparent="${String(transparent)}" data-embed="${String(embed)}" data-live2d-state="${state}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>dsh-Friend Live2D</title>
    <style>
      :root { color-scheme: dark; font-family: ui-rounded, "SF Pro Rounded", system-ui, sans-serif; }
      * { box-sizing: border-box; }
      html, body { min-height: 100%; margin: 0; }
      html[data-transparent="true"], html[data-transparent="true"] body { background: transparent; }
      body { min-height: 100vh; background: radial-gradient(circle at 50% 15%, #334155, #0f172a 62%); color: #e2e8f0; }
      main { width: min(100%, 52rem); min-height: 100vh; margin: 0 auto; display: grid; grid-template-rows: minmax(25rem, 1fr) auto; padding: 1rem; gap: .75rem; }
      #friend-live2d { display: block; width: 100%; height: min(74vh, 46rem); border-radius: 1.25rem; background: linear-gradient(180deg, rgb(14 165 233 / .14), rgb(15 23 42 / .08)); touch-action: none; }
      .toolbar, .installer, .bubble { border: 1px solid rgb(148 163 184 / .28); border-radius: 1rem; background: rgb(15 23 42 / .78); backdrop-filter: blur(12px); padding: .8rem; }
      .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
      .toolbar strong { margin-right: .2rem; }
      button { appearance: none; cursor: pointer; padding: .45rem .7rem; border: 1px solid #475569; border-radius: .65rem; color: #e2e8f0; background: #1e293b; font: inherit; }
      button:hover, button:focus-visible { background: #334155; border-color: #38bdf8; outline: none; }
      .status { margin-left: auto; color: #bae6fd; font-size: .9rem; }
      #friend-sse-state[data-offline="true"] { color: #fecaca; }
      .installer { max-width: 42rem; align-self: center; justify-self: center; margin: 2rem; line-height: 1.65; }
      .installer h1 { margin-top: 0; font-size: 1.35rem; }
      .installer label { display: flex; gap: .5rem; align-items: flex-start; margin: 1rem 0; }
      progress { width: 100%; }
      .error { color: #fecaca; min-height: 1.5rem; }
      code { color: #a7f3d0; }
      .bubble { display: grid; gap: .4rem; }
      .bubble[hidden] { display: none; }
      .bubble input { width: 100%; padding: .45rem .6rem; border-radius: .55rem; border: 1px solid #475569; background: #0f172a; color: inherit; font: inherit; }
      html[data-embed="true"] main { display: block; position: relative; width: 100%; min-height: 100vh; padding: 0; gap: 0; }
      html[data-embed="true"] #friend-live2d { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 0; background: transparent; }
      html[data-embed="true"] .toolbar { display: none; }
      html[data-embed="true"] .bubble { display: none !important; }
    </style>
  </head>
  <body>
    <main aria-live="polite">${content}</main>
  </body>
</html>`
}

function renderReadyViewer(
  targetFps: number,
  modelUrl = '/friend/assets/vendor/hiyori/hiyori_free/runtime/hiyori_free_t08.model3.json',
  embed = false,
  map?: FriendModelMap,
): string {
  const config = JSON.stringify({
    modelUrl,
    canvasId: 'friend-live2d',
    statusId: 'friend-live2d-status',
    initialExpression: 'neutral',
    targetFps,
    embed,
    ...(map !== undefined ? { map } : {}),
  })
  const bubbleMarkup = embed
    ? ''
    : [
        '<section class="bubble" data-friend-bubble data-embed="false" data-open="false">',
        '<p data-friend-typing hidden>正在输入…</p>',
        '<p data-friend-bubble-text></p>',
        '<input id="friend-bubble-input" data-friend-input type="text" enterkeyhint="send" aria-label="快捷聊天" placeholder="回车发送">',
        '</section>',
      ].join('')
  const bubbleScript = embed ? '' : renderPetBubbleScript()

  return `
      <canvas id="friend-live2d" width="768" height="960" aria-label="Live2D companion"></canvas>
      <section class="toolbar" aria-label="Live2D expression controls">
        <strong>Live2D</strong>
        <button type="button" data-expression="neutral">平静</button>
        <button type="button" data-expression="happy">笑</button>
        <button type="button" data-expression="shy">尴尬</button>
        <button type="button" data-expression="sad">难过</button>
        <button type="button" data-expression="surprised">惊讶</button>
        <button type="button" data-expression="sleepy">困倦</button>
        <button type="button" data-expression="angry">生气</button>
        <button type="button" id="friend-voice" hidden>按住说话</button>
        <span id="friend-live2d-status" class="status">正在加载官方 Hiyori 模型…</span>
        <span id="friend-sse-state" class="status" hidden>失联</span>
      </section>
      ${bubbleMarkup}
      <script>window.__DSH_FRIEND_PET_CONFIG__ = ${config};</script>
      <script src="/friend/assets/vendor/cubism-core/live2dcubismcore.min.js" defer></script>
      <script src="/friend/stage/pet.iife.js" defer></script>
      ${renderPerformanceSseScript()}
      ${bubbleScript}`
}

function renderPerformanceSseScript(): string {
  const eventsPath = JSON.stringify(FRIEND_EVENTS_PATH)
  const runtimePath = JSON.stringify(FRIEND_STAGE_RUNTIME_PATH)
  return `<script>
        (() => {
          const eventsPath = ${eventsPath};
          const runtimePath = ${runtimePath};
          const badge = document.getElementById('friend-sse-state');
          let events;
          let enabled = true;
          const applySnapshot = (snapshot) => {
            if (!snapshot || typeof snapshot !== 'object') return;
            const started = Date.now();
            const tryApply = () => {
              const pet = window.__DSH_FRIEND_PET__;
              if (!pet) return false;
              if (typeof pet.applyPerformance === 'function') {
                void pet.applyPerformance(snapshot);
                return true;
              }
              if (snapshot.expression && typeof pet.setExpression === 'function') {
                void pet.setExpression(snapshot.expression);
                return true;
              }
              return false;
            };
            if (tryApply()) return;
            const timer = setInterval(() => {
              if (tryApply() || Date.now() - started > 8000) clearInterval(timer);
            }, 50);
          };
          const readPayload = (raw) => {
            try {
              const parsed = JSON.parse(raw);
              return parsed && parsed.payload ? parsed.payload : parsed;
            } catch {
              return undefined;
            }
          };
          const applyRuntime = (runtime) => {
            if (!runtime || typeof runtime !== 'object') return;
            if (typeof runtime.targetFps === 'number') {
              const pet = window.__DSH_FRIEND_PET__;
              if (pet && typeof pet.setTargetFps === 'function') pet.setTargetFps(runtime.targetFps);
            }
            const next = runtime.enabled !== false;
            if (next === enabled) return;
            enabled = next;
            if (!enabled) {
              if (events) { events.close(); events = undefined; }
              if (badge) { badge.hidden = false; badge.setAttribute('data-offline', 'true'); }
              return;
            }
            connect();
          };
          const connect = () => {
            if (!enabled) return;
            if (events) { try { events.close(); } catch {} }
            events = new EventSource(eventsPath);
            events.addEventListener('open', async () => {
              if (badge) { badge.hidden = true; badge.removeAttribute('data-offline'); }
              try {
                const response = await fetch('/friend/stage/performance');
                if (response.ok) applySnapshot(await response.json());
              } catch {}
            });
            events.addEventListener('error', () => {
              if (badge) { badge.hidden = false; badge.setAttribute('data-offline', 'true'); }
              if (events && events.readyState === 2) {
                events.close();
                if (enabled) setTimeout(connect, 1000);
              }
            });
            for (const type of ['expr', 'motion', 'cue']) {
              events.addEventListener(type, (event) => applySnapshot(readPayload(event.data)));
            }
          };
          const pullRuntime = async () => {
            try {
              const response = await fetch(runtimePath);
              if (response.ok) applyRuntime(await response.json());
            } catch {}
          };
          connect();
          pullRuntime();
          setInterval(pullRuntime, 1000);
        })();
      </script>`
}

function renderPetBubbleScript(): string {
  return `<script>
        (() => {
          const input = document.getElementById('friend-bubble-input');
          const root = document.querySelector('[data-friend-bubble]');
          const text = document.querySelector('[data-friend-bubble-text]');
          const typing = document.querySelector('[data-friend-typing]');
          const hideMs = 8000;
          let hideTimer;
          let lastAssistant = '';
          let lastTyping = false;
          const show = (assistant, isTyping) => {
            if (text) text.textContent = assistant || '';
            if (typing) typing.hidden = !isTyping;
            if (root) root.dataset.open = (isTyping || Boolean(assistant)) ? 'true' : 'false';
            const unchanged = assistant === lastAssistant && isTyping === lastTyping;
            lastAssistant = assistant;
            lastTyping = isTyping;
            if (unchanged) return;
            clearTimeout(hideTimer);
            if (!isTyping && assistant) hideTimer = setTimeout(() => {
              if (text) text.textContent = '';
              if (root) root.dataset.open = 'false';
              lastAssistant = '';
            }, hideMs);
          };
          const pull = async () => {
            try {
              const response = await fetch('/friend/stage/chat');
              if (!response.ok) return;
              const body = await response.json();
              show(body.assistantText || '', Boolean(body.typing));
            } catch {}
          };
          input?.addEventListener('keydown', async (event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            const value = input.value.trim();
            if (!value) return;
            input.value = '';
            show('', true);
            try {
              await fetch('/friend/stage/chat', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ text: value }),
              });
            } catch {}
            pull();
          });
          setInterval(pull, 400);
        })();
      </script>`
}

function renderInstaller(missing: readonly string[]): string {
  const missingLabel = missing.join('、')
  const eventsPath = JSON.stringify(FRIEND_EVENTS_PATH)
  return `
      <section class="installer">
        <h1>安装官方 Live2D 示例模型</h1>
        <p>缺少：<code>${missingLabel}</code>。模型会下载到本机 DSH 数据目录，不会被放入插件包、Git 或 npm。</p>
        <p>将安装 Live2D 官方 <strong>Hiyori Momose - FREE</strong> 和官方 Cubism Core；原始 <code>ReadMe.txt</code> 与本地 NOTICE 会一并保留。</p>
        <label><input id="live2d-license" type="checkbox"> 我已阅读并同意适用的 Live2D 官方许可条款。</label>
        <button id="install-live2d" type="button">下载并启用 Live2D</button>
        <progress id="install-progress" max="100" value="0" hidden></progress>
        <p id="install-phase" role="status"></p>
        <p id="install-error" class="error" role="status"></p>
      </section>
      <script>
        (() => {
          const checkbox = document.getElementById('live2d-license');
          const button = document.getElementById('install-live2d');
          const error = document.getElementById('install-error');
          const bar = document.getElementById('install-progress');
          const phase = document.getElementById('install-phase');
          const eventsPath = ${eventsPath};

          const applySnapshot = (snapshot) => {
            if (!snapshot || typeof snapshot !== 'object') return;
            if (bar instanceof HTMLProgressElement) {
              bar.hidden = false;
              bar.value = typeof snapshot.percent === 'number' ? snapshot.percent : 0;
            }
            if (phase) {
              const pct = typeof snapshot.percent === 'number' ? snapshot.percent : 0;
              phase.textContent = (snapshot.phase || '') + ' ' + pct + '%';
            }
            if (snapshot.phase === 'error') {
              if (error) error.textContent = snapshot.error || '安装失败';
              if (button instanceof HTMLButtonElement) button.disabled = false;
            }
            if (snapshot.phase === 'ready') location.reload();
          };

          const events = new EventSource(eventsPath);
          events.addEventListener('open', async () => {
            try {
              const response = await fetch('/friend/live2d/progress');
              if (response.ok) applySnapshot(await response.json());
            } catch {}
          });
          events.addEventListener('asset-progress', (event) => {
            try {
              const parsed = JSON.parse(event.data);
              applySnapshot(parsed && parsed.payload ? parsed.payload : parsed);
            } catch {}
          });

          button?.addEventListener('click', async () => {
            if (!(checkbox instanceof HTMLInputElement) || !checkbox.checked) {
              error.textContent = '请先确认已同意 Live2D 官方许可条款。';
              return;
            }
            button.disabled = true;
            error.textContent = '正在下载官方模型与运行时…';
            try {
              const response = await fetch('/friend/live2d/install', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accepted: true }),
              });
              const body = await response.json();
              if (!response.ok) throw new Error(body.error || '安装失败');
              if (body.hashPending && error) {
                error.textContent = '已安装，但官方文件 sha256 仍为占位（哈希待填）。';
              }
              location.reload();
            } catch (cause) {
              error.textContent = cause instanceof Error ? cause.message : '安装失败';
              button.disabled = false;
            }
          });
        })();
      </script>`
}

/** Exposed for route-level tests and DSH host registration. */
export function createStageRoutes(options: StageRouteOptions = {}): readonly WebRoute[] {
  const dataRoot = options.dataRoot ?? resolveFriendDataDir()
  const tracker = options.progressTracker ?? createAssetProgressTracker()
  const performance = options.performanceTracker ?? createPerformanceTracker()
  const assets = options.assetStore ?? createDefaultAssetStore(dataRoot, tracker)
  const petBundlePath = options.petBundlePath ?? fileURLToPath(new URL('./pet.iife.js', import.meta.url))
  const resolveTargetFps = options.resolveTargetFps ?? (() => LIVE2D_TARGET_FPS)
  const resolveCoreEnabled = options.resolveCoreEnabled ?? (() => true)
  const chat = options.chatTracker ?? createChatTracker()
  const resolveModel = options.resolveCurrentModel ?? (() => resolveCurrentModel(dataRoot))

  return [
    {
      kind: 'exact',
      path: '/friend/pet',
      async handler(request, response) {
        if (!isGet(request)) return writeText(response, 'Method Not Allowed', 405)
        await pendingBuiltinNailongInstall(dataRoot)?.catch(() => undefined)
        const current = await resolveModel()
        const map = await readFriendMap(dataRoot, current)
        writeHtml(response, renderPetPage(
          isTransparentRequest(request),
          await assets.inspect(),
          resolveTargetFps(),
          { embed: isEmbedRequest(request), modelUrl: current.modelUrl, map },
        ))
      },
    },
    {
      kind: 'exact',
      path: FRIEND_STAGE_RUNTIME_PATH,
      async handler(request, response) {
        if (!isGet(request)) return writeText(response, 'Method Not Allowed', 405)
        writeJson(response, {
          enabled: resolveCoreEnabled(),
          targetFps: resolveTargetFps(),
        })
      },
    },
    {
      kind: 'exact',
      path: '/friend/health',
      async handler(request, response) {
        if (!isGet(request)) return writeText(response, 'Method Not Allowed', 405)
        const status = await assets.inspect()
        writeJson(response, {
          ok: true,
          stage: 'live2d',
          assetMode: status.ready ? 'ready' : 'missing',
          missing: status.missing,
        })
      },
    },
    {
      kind: 'exact',
      path: '/friend/live2d/progress',
      async handler(request, response) {
        if (!isGet(request)) return writeText(response, 'Method Not Allowed', 405)
        writeJson(response, tracker.snapshot())
      },
    },
    {
      kind: 'exact',
      path: '/friend/stage/performance',
      async handler(request, response) {
        if (!isGet(request)) return writeText(response, 'Method Not Allowed', 405)
        writeJson(response, performance.snapshot())
      },
    },
    {
      kind: 'exact',
      path: '/friend/live2d/install',
      async handler(request, response) {
        if (request.method !== 'POST') return writeText(response, 'Method Not Allowed', 405)
        try {
          const accepted = await readLicenseAcceptance(request)
          const status = await assets.install(accepted)
          const integrity = isInstallResult(status) ? status.integrity : undefined
          writeJson(response, {
            ok: status.ready,
            assetMode: status.ready ? 'ready' : 'missing',
            missing: status.missing,
            ...(integrity === undefined ? {} : {
              integrity,
              hashPending: integrity === 'hash-pending',
            }),
          })
        } catch (error) {
          writeJson(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
        }
      },
    },
    {
      kind: 'prefix',
      path: '/friend/assets',
      async handler(request, response) {
        if (!isGet(request)) return writeText(response, 'Method Not Allowed', 405)
        await serveVendorAsset(request, response, dataRoot)
      },
    },
    {
      kind: 'exact',
      path: '/friend/stage/pet.iife.js',
      async handler(request, response) {
        if (!isGet(request)) return writeText(response, 'Method Not Allowed', 405)
        await serveFile(response, petBundlePath)
      },
    },
    ...createModelRoutes({ dataRoot, ...(options.maxModelBytes === undefined ? {} : { maxBytes: options.maxModelBytes }) }),
    ...createChatRoutes({
      chat,
      ...(options.sendCompanion === undefined ? {} : { send: options.sendCompanion }),
      ...(options.watchCompanion === undefined ? {} : { watch: options.watchCompanion }),
    }),
  ]
}

async function readLicenseAcceptance(request: IncomingMessage): Promise<boolean> {
  let body = ''
  for await (const chunk of request) {
    body += String(chunk)
    if (body.length > 8_192) throw new Error('Install request body is too large')
  }
  try {
    return JSON.parse(body).accepted === true
  } catch {
    throw new Error('Install request must contain JSON {"accepted": true}')
  }
}

function isInstallResult(status: Live2DAssetStatus): status is Live2DInstallResult {
  return 'integrity' in status
}

const ASSET_PREFIX = '/friend/assets'

function decodeRequestPath(rawUrl: string): string | undefined {
  const rawPath = rawUrl.split('?')[0] ?? '/'
  let current = rawPath
  for (let i = 0; i < 4; i += 1) {
    try {
      const next = decodeURIComponent(current)
      if (next === current) break
      current = next
    } catch {
      return undefined
    }
  }
  return current
}

function pathHasTraversal(path: string): boolean {
  return path.replace(/\\/gu, '/').split('/').includes('..')
}

async function serveVendorAsset(request: IncomingMessage, response: ServerResponse, dataRoot: string): Promise<void> {
  const rawUrl = request.url ?? '/'
  const decodedPath = decodeRequestPath(rawUrl)
  if (decodedPath === undefined) return writeText(response, 'Bad Request', 400)

  const slashPath = decodedPath.replace(/\\/gu, '/')
  if (!slashPath.startsWith(ASSET_PREFIX)) return writeText(response, 'Not Found', 404)

  if (pathHasTraversal(slashPath) || pathHasTraversal(rawUrl.split('?')[0] ?? '')) {
    return writeText(response, 'Forbidden', 403)
  }

  const remainder = slashPath.slice(ASSET_PREFIX.length).replace(/^\/+/u, '')
  if (remainder.length === 0) return writeText(response, 'Not Found', 404)
  if (!remainder.startsWith('vendor/') && !remainder.startsWith('models/')) {
    return writeText(response, 'Not Found', 404)
  }

  const filePath = resolveFriendAssetPath(dataRoot, remainder)
  if (!filePath) return writeText(response, 'Forbidden', 403)
  await serveFile(response, filePath)
}

async function serveFile(response: ServerResponse, filePath: string): Promise<void> {
  try {
    const file = await readFile(filePath)
    response.statusCode = 200
    response.setHeader('content-type', contentType(filePath))
    // Core/model upgrades must take effect after a page reload; stale WebGL
    // runtime code can fail silently while the status label still says ready.
    response.setHeader('cache-control', 'no-store')
    response.end(file)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    writeText(response, code === 'ENOENT' ? 'Not Found' : 'Unable to read asset', code === 'ENOENT' ? 404 : 500)
  }
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.js': return 'application/javascript; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.png': return 'image/png'
    case '.txt': return 'text/plain; charset=utf-8'
    default: return 'application/octet-stream'
  }
}

/** Register routes through the single DSH HTTP compatibility seam. */
export function apply(ctx: StageApplyContext, config: StageApplyOptions = {}): void {
  logPluginMount(name)
  const role = config.role ?? 'host'
  const performance = config.performanceTracker ?? getSharedPerformanceTracker()
  if (role === 'companion-preset') {
    applyCompanionPreset(ctx, performance)
    return
  }
  applyHost(ctx, performance, config)
}

function applyCompanionPreset(ctx: StageApplyContext, performance: PerformanceTracker): void {
  if (ctx.tools === undefined) {
    throw new Error(
      'dsh-friend-stage: companion-preset apply() needs ctx.tools (register the performance tools on the standing mount, not the host)',
    )
  }
  const disposeTools = registerPerformanceTools({ tools: ctx.tools }, performance)
  ctx.effect?.(() => disposeTools, 'dsh-friend-stage:companion-preset-tools')
}

function applyHost(ctx: StageApplyContext, performance: PerformanceTracker, config: StageApplyOptions): void {
  registerFriendSettings(
    ctx,
    FRIEND_SETTINGS_NAMESPACES.stage,
    createFriendStageSettingsSchema(),
    DEFAULT_STAGE_SETTINGS_ENTRY,
  )
  const routeCtx = requireRouteContext(ctx)
  const tracker = createAssetProgressTracker()
  const chat = config.chatTracker ?? getSharedChatTracker()
  const sendCompanion = config.sendCompanion ?? bindPersonaSend(ctx)
  const push = pushToClient(routeCtx)
  tracker.subscribe((snapshot: AssetProgressSnapshot) => {
    push.push({ type: 'asset-progress', payload: snapshot })
  })
  performance.subscribe((snapshot: PerformanceSnapshot) => {
    push.push({ type: snapshot.lastAction, payload: snapshot })
  })
  const dataRoot = resolveFriendDataDir()
  void scheduleBuiltinNailongInstall(dataRoot).catch(() => undefined)
  for (const route of createStageRoutes({
    dataRoot,
    progressTracker: tracker,
    performanceTracker: performance,
    chatTracker: chat,
    ...(sendCompanion === undefined ? {} : { sendCompanion }),
    ...(config.watchCompanion === undefined ? {} : { watchCompanion: config.watchCompanion }),
    resolveTargetFps: () => {
      const settings = ctx.settings
      if (settings === undefined) return LIVE2D_TARGET_FPS
      try {
        return readStageTargetFps(settings.get(FRIEND_SETTINGS_NAMESPACES.stage))
      } catch {
        return LIVE2D_TARGET_FPS
      }
    },
    resolveCoreEnabled: () => {
      const settings = ctx.settings
      if (settings === undefined) return true
      try {
        return readCoreEnabled(settings.get(FRIEND_SETTINGS_NAMESPACES.core))
      } catch {
        return true
      }
    },
  })) {
    registerRoute(routeCtx, route)
  }

  const source = config.replySource ?? wrapContextSessionEvents(ctx)
  if (source !== undefined) {
    const sink = createCompanionStageSink({ chat, performance })
    const stop = subscribeCompanionReplies(source, (delta) => sink.accept(delta), {
      filter: createCompanionSessionFilter({
        getStandingSessionId: () => standingSessionId(ctx),
      }),
    })
    ctx.effect?.(() => () => {
      stop()
      sink.dispose()
    }, 'dsh-friend-stage: companion-reply')
  }
}

function standingSessionId(ctx: StageApplyContext): string | undefined {
  const settings = ctx.settings
  if (settings === undefined) {
    return undefined
  }
  try {
    return createSettingsSessionIdStore(bindHostSettings({
      get(namespace) {
        return settings.get(namespace)
      },
      update(namespace, patch) {
        if (settings.update === undefined) {
          return Promise.resolve()
        }
        return settings.update(namespace, patch)
      },
    })).get()
  } catch {
    return undefined
  }
}

function requireRouteContext(ctx: StageApplyContext): FriendRouteContext {
  if (ctx.webServer === undefined || ctx.effect === undefined) {
    throw new Error('dsh-friend-stage: host apply() needs ctx.webServer and ctx.effect')
  }
  return { webServer: ctx.webServer, effect: ctx.effect }
}
