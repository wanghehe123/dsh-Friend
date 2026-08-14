/** Cubism `.moc3` magic. Version byte follows at offset 4 (`MocVersion_53 = 6`). */
export const MOC3_MAGIC = 'MOC3'

/**
 * Cubism 5 Core can revive `MocVersion_53 = 6`. That is not enough to
 * draw the model: `pixi-live2d-display@0.4.0` still uses the Cubism 4
 * framework and leaves Cubism 5 meshes fully transparent. Core 5 also
 * moved `renderOrders` off `drawables`; see `core5-compat.ts`.
 */
export const CORE_MAX_MOC_VERSION = 6
export const RENDERER_MAX_MOC_VERSION = 4
export const RUNTIME_MAX_MOC_VERSION = RENDERER_MAX_MOC_VERSION

export function readMoc3Version(bytes: Uint8Array): number | undefined {
  if (bytes.byteLength < 5) {
    return undefined
  }
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0)
  if (magic !== MOC3_MAGIC) {
    return undefined
  }
  const version = bytes[4]
  return version === undefined ? undefined : version
}

export function formatMocVersionError(modelVersion: number, runtimeMax = RUNTIME_MAX_MOC_VERSION): string {
  return `模型版本 ${modelVersion}、渲染器最高版本 ${runtimeMax}。请用 Cubism SDK 4.2 重新导出`
}

export function moc3ExceedsRuntime(version: number, runtimeMax = RUNTIME_MAX_MOC_VERSION): boolean {
  return version > runtimeMax
}

export function readCoreLatestMocVersion(core: unknown): number | undefined {
  if (core === null || typeof core !== 'object') {
    return undefined
  }
  const latest = (core as {
    Version?: { csmGetLatestMocVersion?: () => unknown }
  }).Version?.csmGetLatestMocVersion?.()
  return typeof latest === 'number' && Number.isFinite(latest) ? latest : undefined
}
