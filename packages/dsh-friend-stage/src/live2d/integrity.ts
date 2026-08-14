import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Sentinel in `vendor-integrity.json`. Not a real digest — never treat as verified. */
export const PLACEHOLDER_DIGEST = 'TODO'

export const HIYORI_ZIP_SHA256_ENV = 'FRIEND_LIVE2D_HIYORI_ZIP_SHA256'
export const CUBISM_SDK_ZIP_SHA256_ENV = 'FRIEND_LIVE2D_CUBISM_SDK_ZIP_SHA256'
export const CUBISM_CORE_JS_SHA256_ENV = 'FRIEND_LIVE2D_CUBISM_CORE_JS_SHA256'

export type Live2DExpectedDigests = Readonly<{
  hiyoriZipSha256: string
  cubismSdkZipSha256: string
  cubismCoreJsSha256: string
}>

export type Live2DIntegrity = 'verified' | 'hash-pending'

const SHA256_HEX = /^[0-9a-f]{64}$/iu

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function isPlaceholderDigest(value: string | undefined): boolean {
  if (value === undefined) return true
  const trimmed = value.trim()
  return trimmed.length === 0 || trimmed.toUpperCase() === PLACEHOLDER_DIGEST
}

export function isFilledDigest(value: string): boolean {
  return SHA256_HEX.test(value.trim())
}

/**
 * Compare a downloaded payload to the expected digest.
 * Placeholder expected values skip the check (`hash-pending`).
 * A filled digest that does not match MUST throw — callers must not write `vendor/`.
 */
export function verifySha256(actualHex: string, expected: string, label: string): Live2DIntegrity {
  if (isPlaceholderDigest(expected)) return 'hash-pending'
  const wanted = expected.trim().toLowerCase()
  if (!isFilledDigest(wanted)) {
    throw new Error(`Invalid sha256 expectation for ${label} (not a 64-char hex and not ${PLACEHOLDER_DIGEST})`)
  }
  if (actualHex.toLowerCase() === wanted) return 'verified'
  throw new Error(`sha256 mismatch for ${label}: expected ${wanted}, got ${actualHex.toLowerCase()}`)
}

export function combineIntegrity(parts: readonly Live2DIntegrity[]): Live2DIntegrity {
  if (parts.length === 0) return 'hash-pending'
  return parts.includes('hash-pending') ? 'hash-pending' : 'verified'
}

export function integrityFromExpected(expected: Live2DExpectedDigests): Live2DIntegrity {
  const values = [expected.hiyoriZipSha256, expected.cubismSdkZipSha256, expected.cubismCoreJsSha256]
  return values.some((value) => isPlaceholderDigest(value) || !isFilledDigest(value))
    ? 'hash-pending'
    : 'verified'
}

export function resolveIntegrityManifestPath(): string {
  try {
    const require = createRequire(import.meta.url)
    return join(dirname(require.resolve('@wish233/dsh-friend-stage/package.json')), 'vendor-integrity.json')
  } catch {
    return fileURLToPath(new URL('../../vendor-integrity.json', import.meta.url))
  }
}

/**
 * Load expected digests from `vendor-integrity.json`, overridable by env
 * without editing the file or rebuilding.
 */
export function loadExpectedDigests(
  env: Readonly<Record<string, string | undefined>> = process.env,
  manifestPath = resolveIntegrityManifestPath(),
): Live2DExpectedDigests {
  const fromFile = readManifestFile(manifestPath)
  return {
    hiyoriZipSha256: envString(env, HIYORI_ZIP_SHA256_ENV) ?? fromFile.hiyoriZipSha256 ?? PLACEHOLDER_DIGEST,
    cubismSdkZipSha256: envString(env, CUBISM_SDK_ZIP_SHA256_ENV) ?? fromFile.cubismSdkZipSha256 ?? PLACEHOLDER_DIGEST,
    cubismCoreJsSha256: envString(env, CUBISM_CORE_JS_SHA256_ENV) ?? fromFile.cubismCoreJsSha256 ?? PLACEHOLDER_DIGEST,
  }
}

function envString(env: Readonly<Record<string, string | undefined>>, key: string): string | undefined {
  const value = env[key]?.trim()
  return value === undefined || value.length === 0 ? undefined : value
}

function readManifestFile(manifestPath: string): {
  hiyoriZipSha256?: string
  cubismSdkZipSha256?: string
  cubismCoreJsSha256?: string
} {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return {}
    const record = parsed as Record<string, unknown>
    const result: {
      hiyoriZipSha256?: string
      cubismSdkZipSha256?: string
      cubismCoreJsSha256?: string
    } = {}
    const hiyoriZipSha256 = asString(record.hiyoriZipSha256)
    const cubismSdkZipSha256 = asString(record.cubismSdkZipSha256)
    const cubismCoreJsSha256 = asString(record.cubismCoreJsSha256)
    if (hiyoriZipSha256 !== undefined) result.hiyoriZipSha256 = hiyoriZipSha256
    if (cubismSdkZipSha256 !== undefined) result.cubismSdkZipSha256 = cubismSdkZipSha256
    if (cubismCoreJsSha256 !== undefined) result.cubismCoreJsSha256 = cubismCoreJsSha256
    return result
  } catch {
    return {}
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
