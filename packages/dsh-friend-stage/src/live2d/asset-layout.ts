import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

/**
 * Model data is installed under the user's DSH data directory, never inside
 * the plugin package. That keeps the official Hiyori material out of npm/git
 * redistribution while giving the web server one deterministic source.
 */
export const HIYORI_MODEL_RELATIVE_PATH = 'vendor/hiyori/hiyori_free/runtime/hiyori_free_t08.model3.json'
export const LIVE2D_CORE_RELATIVE_PATH = 'vendor/cubism-core/live2dcubismcore.min.js'

/** Resolve an asset request only when it remains strictly under `dataRoot`. */
export function resolveFriendAssetPath(dataRoot: string, requestedPath: string): string | undefined {
  if (requestedPath.length === 0 || requestedPath.includes('\0') || isAbsolute(requestedPath)) {
    return undefined
  }

  const requestedSegments = requestedPath.split(/[\\/]/u)
  if (requestedSegments.some((segment) => segment === '..')) {
    return undefined
  }

  const normalized = normalize(requestedPath)
  if (normalized === '.' || normalized === '..' || normalized.startsWith(`..${sep}`)) {
    return undefined
  }

  const root = resolve(dataRoot)
  const candidate = resolve(root, normalized)
  const pathFromRoot = relative(root, candidate)
  if (pathFromRoot === '' || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    return undefined
  }

  return join(root, pathFromRoot)
}
