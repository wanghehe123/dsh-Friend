import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import type { Cubism4InternalModel } from 'pixi-live2d-display/cubism4'

import {
  createSnapshotAsrSettingsBinder,
  startAsrClient,
  type FriendAsrBrowserGlobals,
} from '@wishp3/dsh-friend-asr/browser'

import { canvasPointFromClient } from './hit-test.ts'
import {
  aliasCubism4FrameworkModel,
  installCubism5DrawableRenderOrderCompat,
} from './live2d/core5-compat.ts'
import { requireCubismCore } from './live2d/cubism-core-loader.ts'
import {
  CORE_MAX_MOC_VERSION,
  formatMocVersionError,
  moc3ExceedsRuntime,
  readCoreLatestMocVersion,
  readMoc3Version,
  RUNTIME_MAX_MOC_VERSION,
} from './live2d/moc3-version.ts'
import { applyHiyoriFrame, applyLipSyncFrame } from './live2d/hiyori-frame.ts'
import { isHiyoriExpression, resolveHiyoriMotion, type HiyoriExpression } from './live2d/hiyori-adapter.ts'
import {
  expressionNameFromMapFile,
  mappedExpressionFile,
  resolveMappedMotion,
  shouldApplyHiyoriPresets,
} from './live2d/model-adapter.ts'
import { computePetLayout } from './live2d/pet-layout.ts'
import { applyTickerMaxFps, bindVisibilityPause } from './live2d/performance.ts'
import { cueForExpression, readPetPageConfig, type PetPageConfig } from './live2d/pet-config.ts'
import { mountPetAsrClient, postPetStageChat } from './pet-asr.ts'

/** Pet iframe cannot share the overlay `settingsScope`; poll host snapshot after Save. */
export const PET_ASR_SETTINGS_POLL_MS = 1_000
import { isStageMotionGroup, type StageMotionGroup } from './work-cue.ts'

declare global {
  interface Window {
    __DSH_FRIEND_PET_CONFIG__?: unknown
    __DSH_FRIEND_PET__?: MountedLive2DPet
    __DSH_FRIEND_LIPSYNC_LOG__?: number[]
    PIXI?: typeof PIXI
  }
}

export type MountedLive2DPet = Readonly<{
  setExpression: (expression: HiyoriExpression) => Promise<void>
  applyPerformance: (snapshot: { expression: HiyoriExpression; motionGroup: StageMotionGroup }) => Promise<void>
  setLipSync: (level: number) => void
  setTargetFps: (fps: number) => void
  hitTest: (clientX: number, clientY: number) => string[]
  destroy: () => void
}>

/**
 * Mount a real Cubism 3 Hiyori model with PixiJS. The official Cubism Core
 * script must already have loaded before this bundle is evaluated.
 */
export async function mountLive2DPet(config: PetPageConfig): Promise<MountedLive2DPet> {
  const core = requireCubismCore(window)
  installCubism5DrawableRenderOrderCompat(core)
  const coreMax = readCoreLatestMocVersion(core) ?? CORE_MAX_MOC_VERSION
  const runtimeMax = Math.min(coreMax, RUNTIME_MAX_MOC_VERSION)
  await assertRemoteMocSupported(config.modelUrl, runtimeMax)
  const canvas = document.getElementById(config.canvasId)
  const status = document.getElementById(config.statusId)
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error(`Live2D canvas #${config.canvasId} was not found`)
  }

  // pixi-live2d-display obtains the shared ticker from this global at model initialization.
  window.PIXI = PIXI
  const app = new PIXI.Application({
    view: canvas,
    width: Math.max(1, Math.floor(canvas.clientWidth || canvas.width)),
    height: Math.max(1, Math.floor(canvas.clientHeight || canvas.height)),
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  })
  const unbindVisibility = bindVisibilityPause(app.ticker, document, { maxFPS: config.targetFps })

  try {
    const model = await Live2DModel.from(config.modelUrl, {
      autoInteract: false,
      autoUpdate: false,
    }) as Live2DModel<Cubism4InternalModel>
    aliasCubism4FrameworkModel(model.internalModel.coreModel)
    app.stage.addChild(model)
    model.anchor.set(0.5, 1)

    let expression = config.initialExpression
    let lipSyncMouthOpen = 0
    const map = config.map
    model.internalModel.on('beforeModelUpdate', () => {
      if (map === undefined || shouldApplyHiyoriPresets(map)) {
        applyHiyoriFrame(model.internalModel.coreModel, expression, lipSyncMouthOpen, map?.mouthOpenParam)
        return
      }
      applyLipSyncFrame(model.internalModel.coreModel, lipSyncMouthOpen, map.mouthOpenParam)
    })
    const resize = (): boolean => {
      const bounds = canvas.getBoundingClientRect()
      const width = Math.max(1, Math.floor(bounds.width || canvas.width))
      const height = Math.max(1, Math.floor(bounds.height || canvas.height))
      app.renderer.resize(width, height)
      const layout = computePetLayout(model.getLocalBounds(), { width, height })
      if (layout === undefined) {
        return false
      }
      model.scale.set(layout.scale)
      model.x = layout.x
      model.y = layout.y
      return true
    }
    model.update(0)
    let laidOut = resize()
    app.ticker.add(() => {
      model.update(app.ticker.deltaMS)
      if (!laidOut) {
        laidOut = resize()
      }
      lipSyncMouthOpen *= 0.78
    })
    const resizeObserver = new ResizeObserver(() => {
      laidOut = resize()
    })
    resizeObserver.observe(canvas)

    const playMotion = async (motionGroup: StageMotionGroup): Promise<void> => {
      const motion = map === undefined
        ? resolveHiyoriMotion(motionGroup)
        : resolveMappedMotion(map, motionGroup)
      await model.motion(motion.group, motion.index)
    }
    const applyMappedExpression = async (next: HiyoriExpression): Promise<void> => {
      const file = map === undefined ? undefined : mappedExpressionFile(map, next)
      if (file !== undefined && typeof model.expression === 'function') {
        await model.expression(expressionNameFromMapFile(file))
      }
    }
    const setExpression = async (next: HiyoriExpression): Promise<void> => {
      expression = next
      await applyMappedExpression(next)
      const cue = cueForExpression(next)
      await playMotion(cue.motionGroup)
      setStatus(status, expressionLabel(next))
    }
    const applyPerformance = async (snapshot: {
      expression: HiyoriExpression
      motionGroup: StageMotionGroup
    }): Promise<void> => {
      if (!isHiyoriExpression(snapshot.expression)) return
      if (!isStageMotionGroup(snapshot.motionGroup)) return
      expression = snapshot.expression
      await applyMappedExpression(snapshot.expression)
      await playMotion(snapshot.motionGroup)
      setStatus(status, expressionLabel(snapshot.expression))
    }
    const setLipSync = (level: number): void => {
      lipSyncMouthOpen = Math.min(1, Math.max(0, level))
    }
    const setTargetFps = (fps: number): void => {
      applyTickerMaxFps(app.ticker, fps)
    }
    const hitTest = (clientX: number, clientY: number): string[] => {
      const bounds = canvas.getBoundingClientRect()
      const local = canvasPointFromClient({ x: clientX, y: clientY }, bounds)
      if (typeof model.hitTest !== 'function') return []
      const hits = model.hitTest(local.x, local.y)
      return Array.isArray(hits) ? hits.filter((name): name is string => typeof name === 'string') : []
    }
    const onCanvasPointer = (event: PointerEvent): void => {
      const hits = hitTest(event.clientX, event.clientY)
      window.dispatchEvent(new CustomEvent('dsh-friend:hit', { detail: { hits } }))
    }
    canvas.addEventListener('pointerdown', onCanvasPointer)

    const onExpressionButton = (event: Event): void => {
      const target = event.currentTarget
      if (!(target instanceof HTMLButtonElement)) return
      const next = target.dataset.expression
      if (next && isHiyoriExpression(next)) void setExpression(next)
    }
    const expressionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-expression]'))
    expressionButtons.forEach((button) => button.addEventListener('click', onExpressionButton))

    const applyLipSync = (level: number): void => {
      setLipSync(level)
      const log = window.__DSH_FRIEND_LIPSYNC_LOG__
      if (!Array.isArray(log)) {
        window.__DSH_FRIEND_LIPSYNC_LOG__ = [level]
      } else {
        log.push(level)
        if (log.length > 128) log.shift()
      }
    }
    const onLipSyncEvent = (event: Event): void => {
      if (!(event instanceof CustomEvent) || typeof event.detail?.level !== 'number') return
      applyLipSync(event.detail.level)
    }
    const onLipSyncMessage = (event: MessageEvent): void => {
      const data = event.data
      if (data === null || typeof data !== 'object') return
      const record = data as { type?: unknown; level?: unknown }
      if (record.type !== 'dsh-friend:lipsync' || typeof record.level !== 'number') return
      applyLipSync(record.level)
    }
    window.addEventListener('dsh-friend:lipsync', onLipSyncEvent)
    window.addEventListener('message', onLipSyncMessage)

    await setExpression(expression)
    laidOut = resize() || laidOut
    setStatus(status, '模型已就绪')

    return {
      setExpression,
      applyPerformance,
      setLipSync,
      setTargetFps,
      hitTest,
      destroy: () => {
        canvas.removeEventListener('pointerdown', onCanvasPointer)
        window.removeEventListener('dsh-friend:lipsync', onLipSyncEvent)
        window.removeEventListener('message', onLipSyncMessage)
        expressionButtons.forEach((button) => button.removeEventListener('click', onExpressionButton))
        resizeObserver.disconnect()
        unbindVisibility()
        app.ticker.stop()
        model.destroy({ children: true, texture: true, baseTexture: true })
        app.destroy(true, { children: true, texture: true, baseTexture: true })
      },
    }
  } catch (error) {
    unbindVisibility()
    app.destroy(true, { children: true, texture: true, baseTexture: true })
    throw error
  }
}

function setStatus(status: HTMLElement | null, text: string): void {
  if (status) status.textContent = text
}

function expressionLabel(expression: HiyoriExpression): string {
  return {
    neutral: '平静',
    happy: '笑',
    shy: '尴尬',
    sad: '难过',
    surprised: '惊讶',
    sleepy: '困倦',
    angry: '生气',
  }[expression]
}

async function mountFromPage(): Promise<void> {
  const config = readPetPageConfig(window.__DSH_FRIEND_PET_CONFIG__)
  if (!config) return
  const status = document.getElementById(config.statusId)
  if (config.embed !== true) {
    mountPetAsrClient({
      window,
      document,
      factory: (ctx) => startAsrClient({
        window: ctx.window as FriendAsrBrowserGlobals,
        settingsScope: createSnapshotAsrSettingsBinder({ pollMs: PET_ASR_SETTINGS_POLL_MS }),
        ...(ctx.onSend === undefined ? {} : { onSend: ctx.onSend }),
      }),
      onSend: postPetStageChat,
    })
  }
  try {
    window.__DSH_FRIEND_PET__ = await mountLive2DPet(config)
  } catch (error) {
    setStatus(status, `模型加载失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

void mountFromPage()

async function assertRemoteMocSupported(modelUrl: string, runtimeMax: number): Promise<void> {
  const fetchImpl = (globalThis as { fetch?: typeof fetch }).fetch
  if (fetchImpl === undefined) {
    return
  }
  try {
    const modelResponse = await fetchImpl(modelUrl)
    if (!modelResponse.ok) {
      return
    }
    const document = await modelResponse.json() as { FileReferences?: { Moc?: unknown } }
    const moc = document.FileReferences?.Moc
    if (typeof moc !== 'string' || moc.length === 0) {
      return
    }
    const mocUrl = new URL(moc, new URL(modelUrl, 'http://dsh.local')).pathname
    const mocResponse = await fetchImpl(mocUrl)
    if (!mocResponse.ok) {
      return
    }
    const version = readMoc3Version(new Uint8Array(await mocResponse.arrayBuffer()))
    if (version !== undefined && moc3ExceedsRuntime(version, runtimeMax)) {
      throw new Error(formatMocVersionError(version, runtimeMax))
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('模型版本')) {
      throw error
    }
  }
}
