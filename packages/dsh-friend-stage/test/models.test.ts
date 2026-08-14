import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'

import { generateDefaultFriendMap } from '../src/model-map.ts'
import {
  BUILTIN_HIYORI_NAME,
  HIYORI_DEFAULT_MAP,
  deleteUserModel,
  readModelCatalog,
  resolveCurrentModel,
  uploadModelZip,
} from '../src/models.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-friend-models-'))
  temporaryRoots.push(root)
  return root
}

const HIYORI_MODEL3 = {
  Version: 3,
  FileReferences: {
    Motions: {
      Idle: [
        { File: 'motion/hiyori_m01.motion3.json' },
        { File: 'motion/hiyori_m02.motion3.json' },
        { File: 'motion/hiyori_m03.motion3.json' },
      ],
      Flick: [{ File: 'motion/hiyori_m04.motion3.json' }],
      FlickDown: [{ File: 'motion/hiyori_m05.motion3.json' }],
      'Flick@Body': [{ File: 'motion/hiyori_m06.motion3.json' }],
      Tap: [{ File: 'motion/hiyori_m07.motion3.json' }],
      'Tap@Body': [{ File: 'motion/hiyori_m08.motion3.json' }],
    },
  },
}

function modelZip(entries: Record<string, string>): Uint8Array {
  const encoded: Record<string, Uint8Array> = {}
  for (const [name, text] of Object.entries(entries)) {
    encoded[name] = strToU8(text)
  }
  return zipSync(encoded)
}

describe('model zip upload', () => {
  it('accepts a zip that contains model3.json and writes models/<name>/', async () => {
    const root = await tempRoot()
    const archive = modelZip({
      'neko/runtime/neko.model3.json': JSON.stringify({
        Version: 3,
        FileReferences: {
          Expressions: [{ Name: 'happy', File: 'exp/happy.exp3.json' }],
          Motions: { Idle: [{ File: 'motion/idle.motion3.json' }] },
        },
      }),
    })

    const result = await uploadModelZip({ dataRoot: root, archive, name: 'neko' })
    expect(result.name).toBe('neko')
    expect(result.catalog.current).toBe('neko')
    expect(result.map.expressions.happy).toBe('exp/happy.exp3.json')
    const map = await readFile(join(root, 'models/neko/friend.map.json'), 'utf8')
    expect(JSON.parse(map).mouthOpenParam).toBe('ParamMouthOpenY')
    await expect(readFile(join(root, 'models/neko/runtime/neko.model3.json'), 'utf8')).resolves.toContain('happy')
  })

  it('rejects a zip that does not contain model3.json', async () => {
    const root = await tempRoot()
    await expect(uploadModelZip({
      dataRoot: root,
      archive: modelZip({ 'readme.txt': 'no model' }),
    })).rejects.toThrow(/model3\.json/)
    const catalog = await readModelCatalog(root)
    expect(catalog.models.map((model) => model.name)).toEqual([BUILTIN_HIYORI_NAME])
  })

  it('rejects zip-slip entries and does not write outside the staging tree', async () => {
    const root = await tempRoot()
    await expect(uploadModelZip({
      dataRoot: root,
      archive: modelZip({
        'safe/ok.model3.json': '{}',
        'safe/foo/../../evil.txt': 'nope',
      }),
    })).rejects.toThrow(/zip-slip/)
    await expect(readFile(join(root, 'evil.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an archive over the configured size cap', async () => {
    const root = await tempRoot()
    const archive = modelZip({ 'tiny.model3.json': '{}' })
    await expect(uploadModelZip({
      dataRoot: root,
      archive,
      maxBytes: 10,
    })).rejects.toThrow(/size limit/)
  })

  it('falls back to built-in Hiyori when the current user model is deleted', async () => {
    const root = await tempRoot()
    await uploadModelZip({
      dataRoot: root,
      archive: modelZip({ 'user/a.model3.json': '{}' }),
      name: 'user',
    })
    expect((await resolveCurrentModel(root)).name).toBe('user')
    const after = await deleteUserModel(root, 'user')
    expect(after.current).toBe(BUILTIN_HIYORI_NAME)
    expect((await resolveCurrentModel(root)).name).toBe(BUILTIN_HIYORI_NAME)
  })
})

describe('default friend.map.json for Hiyori', () => {
  it('snapshots Hiyori FREE motion groups and the default mouth parameter', () => {
    expect(generateDefaultFriendMap(HIYORI_MODEL3)).toEqual(HIYORI_DEFAULT_MAP)
    expect(HIYORI_DEFAULT_MAP).toMatchSnapshot()
    expect(HIYORI_DEFAULT_MAP.mouthOpenParam).toBe('ParamMouthOpenY')
    expect(Object.keys(HIYORI_DEFAULT_MAP.motions)).toEqual([
      'Idle',
      'Flick',
      'FlickDown',
      'Flick@Body',
      'Tap',
      'Tap@Body',
    ])
  })
})
