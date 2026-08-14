import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_PERSONA, DEFAULT_PERSONA_SLUG } from '../src/default-persona.ts'
import { personaFilePath } from '../src/paths.ts'
import { PersonaValidationError, type Persona } from '../src/schema.ts'
import { slugify } from '../src/slug.ts'
import { PersonaStore, createPersonaStore } from '../src/store.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempStore(): Promise<PersonaStore> {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-friend-persona-'))
  temporaryRoots.push(dataDir)
  return new PersonaStore({ dataDir })
}

function samplePersona(overrides: Partial<Persona> = {}): Persona {
  return {
    name: 'Alice',
    personality: 'bright',
    background: 'a student',
    speakingStyle: 'short sentences',
    language: 'en',
    nickname: 'friend',
    greetings: ['hi'],
    tags: ['test'],
    ...overrides,
  }
}

describe('PersonaStore', () => {
  it('round-trips create / get / list / update / remove', async () => {
    const store = await tempStore()
    const created = await store.create(samplePersona({
      live2dModel: 'hiyori',
      voice: 'en-US-AriaNeural',
    }))

    expect(created.slug).toBe('alice')
    expect(created.name).toBe('Alice')
    expect(created.live2dModel).toBe('hiyori')

    await expect(store.get('alice')).resolves.toEqual(created)
    await expect(store.list()).resolves.toEqual([created])

    const updated = await store.update('alice', samplePersona({
      name: 'Alice',
      personality: 'calmer now',
      live2dModel: 'hiyori',
      voice: 'en-US-AriaNeural',
    }))
    expect(updated.personality).toBe('calmer now')
    await expect(store.get('alice')).resolves.toEqual(updated)

    await expect(store.remove('alice')).resolves.toBe(true)
    await expect(store.get('alice')).resolves.toBeUndefined()
    await expect(store.list()).resolves.toEqual([])
  })

  it('rejects an illegal card and leaves the on-disk file untouched', async () => {
    const store = await tempStore()
    const created = await store.create(samplePersona({ personality: 'original' }))
    const filePath = store.personaPath(created.slug)
    const before = await readFile(filePath, 'utf8')

    await expect(store.update(created.slug, {
      personality: 'changed',
      background: 'x',
      speakingStyle: 'x',
      language: 'zh-CN',
      nickname: '你',
      greetings: [],
      tags: [],
    } as unknown as Persona)).rejects.toBeInstanceOf(PersonaValidationError)

    await expect(store.update(created.slug, {
      name: 'Alice',
      personality: 1,
      background: 'x',
      speakingStyle: 'x',
      language: 'zh-CN',
      nickname: '你',
      greetings: [],
      tags: [],
    } as unknown as Persona)).rejects.toThrow(/personality 必须是字符串/)

    expect(await readFile(filePath, 'utf8')).toBe(before)
    await expect(store.get(created.slug)).resolves.toMatchObject({ personality: 'original' })
  })

  it('builds a usable slug from a Chinese name and suffixes collisions', async () => {
    const store = await tempStore()
    expect(slugify('小友')).toBe('小友')

    const first = await store.create(samplePersona({ name: '小友' }))
    const second = await store.create(samplePersona({ name: '小友' }))
    const third = await store.create(samplePersona({ name: '小友' }))

    expect(first.slug).toBe('小友')
    expect(second.slug).toBe('小友-2')
    expect(third.slug).toBe('小友-3')
    expect((await store.list()).map((record) => record.slug)).toEqual(['小友', '小友-2', '小友-3'])
  })

  it('seeds the default companion once and does not overwrite user edits', async () => {
    const store = await tempStore()
    const first = await store.seedDefault()
    expect(first.created).toBe(true)
    expect(first.record.slug).toBe(DEFAULT_PERSONA_SLUG)
    expect(first.record.name).toBe(DEFAULT_PERSONA.name)
    expect(first.record.greetings.length).toBeGreaterThan(0)

    const filePath = store.personaPath(DEFAULT_PERSONA_SLUG)
    const edited = {
      ...DEFAULT_PERSONA,
      personality: '用户改过的性格',
      greetings: ['改过的招呼'],
    }
    await writeFile(filePath, `${JSON.stringify(edited, null, 2)}\n`, 'utf8')

    const second = await store.seedDefault()
    expect(second.created).toBe(false)
    expect(second.record.personality).toBe('用户改过的性格')
    await expect(store.get(DEFAULT_PERSONA_SLUG)).resolves.toMatchObject({
      personality: '用户改过的性格',
      greetings: ['改过的招呼'],
    })
  })

  it('reads a persona.json that was edited outside the store', async () => {
    const store = await tempStore()
    const created = await store.create(samplePersona({ personality: 'before' }))
    const filePath = personaFilePath(store.dataDir, created.slug)
    const onDisk = JSON.parse(await readFile(filePath, 'utf8')) as Persona
    await writeFile(filePath, `${JSON.stringify({ ...onDisk, personality: 'after-external-edit' }, null, 2)}\n`)

    await expect(store.get(created.slug)).resolves.toMatchObject({ personality: 'after-external-edit' })
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ slug: created.slug, personality: 'after-external-edit' }),
    ])
  })

  it('creates a store from an injected override and never needs ~/.dsh', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'dsh-friend-persona-override-'))
    temporaryRoots.push(dataDir)
    const store = createPersonaStore({ override: dataDir, env: {}, homedir: '/Users/example' })
    expect(store.dataDir).toBe(dataDir)
    const created = await store.create(samplePersona())
    expect(created.slug).toBe('alice')
  })
})
