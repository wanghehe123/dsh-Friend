import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { resolveFriendDataDir } from '@wish233/dsh-friend-shared'

import {
  CUBISM_CORE_OFFICIAL_SOURCE_URL,
  CUBISM_SDK_RELEASE,
  CUBISM_SDK_RELEASE_RELATIVE_PATH,
  HIYORI_MODEL_RELATIVE_PATH,
  LIVE2D_CORE_RELATIVE_PATH,
} from './asset-layout.ts'

/** Official URLs recorded with each local installation for traceability. */
export const HIYORI_OFFICIAL_SOURCE_URL = 'https://cubism.live2d.com/sample-data/bin/hiyori/hiyori_en.zip'
export { CUBISM_CORE_OFFICIAL_SOURCE_URL, CUBISM_SDK_RELEASE }
export const LIVE2D_VENDOR_NOTICE_RELATIVE_PATH = 'vendor/NOTICE.txt'

export type Live2DAssetStatus = Readonly<{
  ready: boolean
  modelPath: string
  corePath: string
  missing: readonly ('model' | 'core')[]
}>

/**
 * Historical `(env, userHome)` signature. Delegates to the shared
 * {@link resolveFriendDataDir} so stage and persona resolve the same root.
 */
export function resolveFriendDataRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
  userHome = homedir(),
): string {
  return resolveFriendDataDir({ env, homedir: userHome })
}

/** Inspect the local vendor state without triggering a download. */
export async function inspectLive2DAssets(dataRoot: string): Promise<Live2DAssetStatus> {
  const modelPath = join(dataRoot, HIYORI_MODEL_RELATIVE_PATH)
  const corePath = join(dataRoot, LIVE2D_CORE_RELATIVE_PATH)
  const [modelReady, coreFileReady, coreReleaseReady] = await Promise.all([
    fileExists(modelPath),
    fileExists(corePath),
    coreReleaseMatches(dataRoot),
  ])
  const coreReady = coreFileReady && coreReleaseReady
  const missing: ('model' | 'core')[] = []
  if (!modelReady) missing.push('model')
  if (!coreReady) missing.push('core')

  return {
    ready: missing.length === 0,
    modelPath,
    corePath,
    missing,
  }
}

/** Text written beside installed assets, retaining attribution and license trail. */
export function renderVendorNotice(installedAt: string): string {
  return `dsh-Friend local Live2D vendor assets

Hiyori Momose - FREE is an official Live2D sample model.
Hiyori source: ${HIYORI_OFFICIAL_SOURCE_URL}
Cubism Core source: ${CUBISM_CORE_OFFICIAL_SOURCE_URL}
Installed at: ${installedAt}

The original model ReadMe.txt remains in the Hiyori directory. These files are
kept in local DSH data only and are not redistributed in this plugin package.
Use is subject to the applicable Live2D terms accepted during installation.
`
}

async function coreReleaseMatches(dataRoot: string): Promise<boolean> {
  try {
    const text = (await readFile(join(dataRoot, CUBISM_SDK_RELEASE_RELATIVE_PATH), 'utf8')).trim()
    return text === CUBISM_SDK_RELEASE
  } catch {
    return false
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
