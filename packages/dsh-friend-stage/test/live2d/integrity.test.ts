import { describe, expect, it } from 'vitest'

import {
  isPlaceholderDigest,
  loadExpectedDigests,
  PLACEHOLDER_DIGEST,
  sha256Hex,
  verifySha256,
} from '../../src/live2d/integrity.ts'

describe('vendor integrity digests', () => {
  it('treats TODO as a placeholder and never accepts it as a match', () => {
    expect(isPlaceholderDigest(PLACEHOLDER_DIGEST)).toBe(true)
    expect(isPlaceholderDigest('')).toBe(true)
    expect(verifySha256(sha256Hex(new Uint8Array([1])), PLACEHOLDER_DIGEST, 'sample')).toBe('hash-pending')
  })

  it('throws on a filled digest mismatch so callers can skip vendor writes', () => {
    const actual = sha256Hex(new TextEncoder().encode('payload'))
    expect(() => verifySha256(actual, 'a'.repeat(64), 'sample')).toThrow(/sha256 mismatch/)
    expect(verifySha256(actual, actual, 'sample')).toBe('verified')
  })

  it('loads TODO placeholders from vendor-integrity.json', () => {
    const digests = loadExpectedDigests({})
    expect(digests.hiyoriZipSha256).toBe(PLACEHOLDER_DIGEST)
    expect(digests.cubismSdkZipSha256).toBe(PLACEHOLDER_DIGEST)
    expect(digests.cubismCoreJsSha256).toBe(PLACEHOLDER_DIGEST)
  })

  it('lets env vars override the manifest without editing the file', () => {
    const filled = 'd'.repeat(64)
    const digests = loadExpectedDigests({
      FRIEND_LIVE2D_HIYORI_ZIP_SHA256: filled,
    })
    expect(digests.hiyoriZipSha256).toBe(filled)
    expect(digests.cubismSdkZipSha256).toBe(PLACEHOLDER_DIGEST)
  })
})
