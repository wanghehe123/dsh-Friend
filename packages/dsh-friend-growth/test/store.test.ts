import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { lockedAtomicWrite } from '../src/atomic.ts'
import { GrowthStore } from '../src/store.ts'
import { tempDataDir } from './helpers/tmp.ts'

describe('atomic draft writes', () => {
  it('keeps a valid JSON file when two writers finish concurrently', async () => {
    const dataDir = await tempDataDir()
    const store = new GrowthStore({ dataDir, slug: 'default' })
    await store.initBatch({
      batchId: 'b1',
      profile: {
        characterId: 'default',
        baseAttributes: '{}',
        worldSetting: '',
        lifeStorySummary: '',
        status: 'drafting',
        language: '中文',
      },
    })
    const path = join(store.batchDir('b1'), 'beats.json')
    await Promise.all([
      lockedAtomicWrite(path, `${JSON.stringify([{ id: 'a' }], null, 2)}\n`),
      lockedAtomicWrite(path, `${JSON.stringify([{ id: 'b' }, { id: 'c' }], null, 2)}\n`),
    ])
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    expect(Array.isArray(parsed)).toBe(true)
    const ids = (parsed as Array<{ id: string }>).map((item) => item.id)
    expect(ids.length === 1 || ids.length === 2).toBe(true)
    expect(ids.every((id) => id === 'a' || id === 'b' || id === 'c')).toBe(true)
  })

  it('does not tear the destination when rename is interrupted', async () => {
    const dataDir = await tempDataDir()
    const store = new GrowthStore({ dataDir, slug: 'default' })
    await store.initBatch({
      batchId: 'b1',
      profile: {
        characterId: 'default',
        baseAttributes: '{}',
        worldSetting: '',
        lifeStorySummary: '',
        status: 'drafting',
        language: '中文',
      },
    })
    const path = join(store.batchDir('b1'), 'outline.json')
    await lockedAtomicWrite(path, '[]\n')
    await expect(lockedAtomicWrite(path, '[{"age":1}]\n', {
      beforeRename: async () => {
        throw new Error('crash-during-write')
      },
    })).rejects.toThrow(/crash-during-write/)
    expect(await readFile(path, 'utf8')).toBe('[]\n')
  })
})

describe('live character slug', () => {
  it('writes the new character directory after currentSlug changes and keeps the old one', async () => {
    const dataDir = await tempDataDir()
    let slug = 'alice'
    const store = new GrowthStore({ dataDir, slug: () => slug })
    await store.writeProfile({
      characterId: 'alice',
      baseAttributes: '{}',
      worldSetting: '',
      lifeStorySummary: 'alice-story',
      status: 'drafting',
      language: '中文',
    })
    slug = 'bob'
    await store.writeProfile({
      characterId: 'bob',
      baseAttributes: '{}',
      worldSetting: '',
      lifeStorySummary: 'bob-story',
      status: 'drafting',
      language: '中文',
    })

    const alice = JSON.parse(await readFile(join(dataDir, 'characters/alice/growth/profile.json'), 'utf8')) as {
      lifeStorySummary: string
    }
    const bob = JSON.parse(await readFile(join(dataDir, 'characters/bob/growth/profile.json'), 'utf8')) as {
      lifeStorySummary: string
    }
    expect(alice.lifeStorySummary).toBe('alice-story')
    expect(bob.lifeStorySummary).toBe('bob-story')
  })

  it('keeps an in-flight write on the start slug when currentSlug flips mid-rename', async () => {
    const dataDir = await tempDataDir()
    let slug = 'alice'
    const store = new GrowthStore({ dataDir, slug: () => slug })
    await store.writeProfile({
      characterId: 'alice',
      baseAttributes: '{}',
      worldSetting: '',
      lifeStorySummary: 'alice-old',
      status: 'drafting',
      language: '中文',
    })

    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = store.writeProfile({
      characterId: 'alice',
      baseAttributes: '{}',
      worldSetting: '',
      lifeStorySummary: 'alice-inflight',
      status: 'drafting',
      language: '中文',
    }, { beforeRename: () => gate })
    slug = 'bob'
    await store.writeProfile({
      characterId: 'bob',
      baseAttributes: '{}',
      worldSetting: '',
      lifeStorySummary: 'bob-story',
      status: 'drafting',
      language: '中文',
    })
    release()
    await pending

    const alice = JSON.parse(await readFile(join(dataDir, 'characters/alice/growth/profile.json'), 'utf8')) as {
      lifeStorySummary: string
    }
    const bob = JSON.parse(await readFile(join(dataDir, 'characters/bob/growth/profile.json'), 'utf8')) as {
      lifeStorySummary: string
    }
    expect(alice.lifeStorySummary).toBe('alice-inflight')
    expect(bob.lifeStorySummary).toBe('bob-story')
  })
})
