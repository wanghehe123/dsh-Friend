import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'

import { generateDefaultFriendMap } from '../src/model-map.ts'
import {
  BUILTIN_HIYORI_NAME,
  BUILTIN_NAILONG_LABEL,
  BUILTIN_NAILONG_NAME,
  HIYORI_DEFAULT_MAP,
  deleteUserModel,
  ensureBuiltinNailong,
  readFriendMap,
  readModelCatalog,
  resolveBundledNailongZip,
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

function nailongFixtureZip(): Uint8Array {
  return modelZip({
    'naiwa-live2d-v3.model3.json': JSON.stringify({
      Version: 3,
      FileReferences: {
        Moc: 'naiwa-live2d-v3.moc3',
        Expressions: [
          { Name: 'calm', File: 'expressions/calm.exp3.json' },
          { Name: 'smile', File: 'expressions/smile.exp3.json' },
          { Name: 'surprise', File: 'expressions/surprise.exp3.json' },
        ],
        Motions: { Idle: [{ File: 'motions/idle.motion3.json' }] },
      },
    }),
    'expressions/calm.exp3.json': '{}',
    'expressions/smile.exp3.json': '{}',
    'expressions/surprise.exp3.json': '{}',
    'motions/idle.motion3.json': '{}',
  })
}

describe('built-in 奶龙 Live2D', () => {
  it('is absent from the catalog until the runtime zip is installed', async () => {
    const root = await tempRoot()
    const catalog = await readModelCatalog(root)
    expect(catalog.models.map((model) => model.name)).toEqual([BUILTIN_HIYORI_NAME])
  })

  it('extracts the runtime zip into vendor/nailong and lists 奶龙 as builtin', async () => {
    const root = await tempRoot()
    const installed = await ensureBuiltinNailong({ dataRoot: root, archive: nailongFixtureZip() })
    expect(installed?.name).toBe(BUILTIN_NAILONG_NAME)
    expect(installed?.kind).toBe('builtin')
    expect(installed?.label).toBe(BUILTIN_NAILONG_LABEL)
    expect(installed?.model3Relative).toBe('vendor/nailong/naiwa-live2d-v3.model3.json')

    const catalog = await readModelCatalog(root)
    expect(catalog.models.map((model) => model.name)).toEqual([
      BUILTIN_HIYORI_NAME,
      BUILTIN_NAILONG_NAME,
    ])
    expect(catalog.models.find((model) => model.name === BUILTIN_NAILONG_NAME)?.label)
      .toBe('奶龙')
  })

  it('is idempotent when vendor/nailong already exists', async () => {
    const root = await tempRoot()
    await ensureBuiltinNailong({ dataRoot: root, archive: nailongFixtureZip() })
    const second = await ensureBuiltinNailong({ dataRoot: root, archive: new Uint8Array([1, 2, 3]) })
    expect(second?.model3Relative).toBe('vendor/nailong/naiwa-live2d-v3.model3.json')
    const catalog = await readModelCatalog(root)
    expect(catalog.models.filter((model) => model.name === BUILTIN_NAILONG_NAME)).toHaveLength(1)
  })

  it('refuses to delete 奶龙 or upload over the reserved name', async () => {
    const root = await tempRoot()
    await ensureBuiltinNailong({ dataRoot: root, archive: nailongFixtureZip() })
    await expect(deleteUserModel(root, BUILTIN_NAILONG_NAME)).rejects.toThrow(/奶龙|built-in|reserved/i)
    await expect(uploadModelZip({
      dataRoot: root,
      archive: modelZip({ 'other.model3.json': '{}' }),
      name: BUILTIN_NAILONG_NAME,
    })).rejects.toThrow(/reserved/)
    const catalog = await readModelCatalog(root)
    expect(catalog.models.some((model) => model.name === BUILTIN_NAILONG_NAME)).toBe(true)
  })

  it('maps smile/calm/surprise and Idle instead of the Hiyori motion fixture', async () => {
    const root = await tempRoot()
    const model = await ensureBuiltinNailong({ dataRoot: root, archive: nailongFixtureZip() })
    expect(model).toBeDefined()
    const map = await readFriendMap(root, model!)
    expect(map.expressions.happy).toBe('expressions/smile.exp3.json')
    expect(map.expressions.neutral).toBe('expressions/calm.exp3.json')
    expect(map.expressions.surprised).toBe('expressions/surprise.exp3.json')
    expect(map.motions.Idle).toEqual(['motions/idle.motion3.json'])
    expect(map.motions.Tap).toBeUndefined()
  })

  it('resolves the repo runtime zip by walking up from the package', () => {
    const zipPath = resolveBundledNailongZip()
    expect(zipPath).toMatch(/naiwa-live2d-v3-sdk4\.2-runtime\.zip$/)
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
