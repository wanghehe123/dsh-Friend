import { describe, expect, it } from 'vitest'

import { strToU8, zipSync } from 'fflate'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MOC3_MAGIC,
  RUNTIME_MAX_MOC_VERSION,
  formatMocVersionError,
  readMoc3Version,
} from '../src/live2d/moc3-version.ts'
import { uploadModelZip } from '../src/models.ts'

function moc3Bytes(version: number): Uint8Array {
  const bytes = new Uint8Array(8)
  bytes.set(new TextEncoder().encode(MOC3_MAGIC), 0)
  bytes[4] = version
  return bytes
}

describe('readMoc3Version', () => {
  it('reads the Cubism moc version byte after the MOC3 magic', () => {
    expect(readMoc3Version(moc3Bytes(4))).toBe(4)
    expect(readMoc3Version(moc3Bytes(6))).toBe(6)
    expect(readMoc3Version(new Uint8Array([1, 2, 3]))).toBeUndefined()
    expect(readMoc3Version(new TextEncoder().encode('JSON'))).toBeUndefined()
  })

  it('names a rejected newer moc against the runtime ceiling', () => {
    expect(formatMocVersionError(6, 4)).toBe('模型版本 6、渲染器最高版本 4。请用 Cubism SDK 4.2 重新导出')
    expect(RUNTIME_MAX_MOC_VERSION).toBe(4)
  })
})

describe('upload rejects an unsupported moc3', () => {
  it('rejects Cubism 5.3 moc even when Core 5 can parse it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-friend-moc3-'))
    try {
      const archive = zipSync({
        'naiwa/naiwa.model3.json': strToU8(JSON.stringify({
          Version: 3,
          FileReferences: { Moc: 'naiwa.moc3' },
        })),
        'naiwa/naiwa.moc3': moc3Bytes(6),
      })
      await expect(uploadModelZip({ dataRoot: root, archive, name: 'naiwa' }))
        .rejects.toThrow(/模型版本 6、渲染器最高版本 4/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails with a version message instead of accepting the zip', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-friend-moc3-'))
    try {
      const archive = zipSync({
        'too-new/too-new.model3.json': strToU8(JSON.stringify({
          Version: 3,
          FileReferences: { Moc: 'too-new.moc3' },
        })),
        'too-new/too-new.moc3': moc3Bytes(99),
      })
      await expect(uploadModelZip({ dataRoot: root, archive, name: 'too-new' }))
        .rejects.toThrow(/模型版本 99、渲染器最高版本 4/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
