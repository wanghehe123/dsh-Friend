import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { importKokoro, type KokoroSnapshot, type SqliteLike } from '../src/import-kokoro.ts'
import { MemoryStore } from '../src/store.ts'
import { tempDataDir } from './helpers/tmp.ts'

function snapshotDb(snapshot: KokoroSnapshot): SqliteLike {
  return {
    prepare(sql: string) {
      return {
        all: () => {
          if (sql.includes('FROM memories')) {
            return snapshot.memories.map((row) => ({ ...row }))
          }
          if (sql.includes('FROM characters')) {
            return snapshot.characters.map((row) => ({ ...row }))
          }
          if (sql.includes('FROM growth_beats')) {
            return snapshot.growthBeats.map((row) => ({ ...row }))
          }
          throw new Error(`unexpected sql ${sql}`)
        },
      }
    },
  }
}

const fixture: KokoroSnapshot = {
  memories: [
    {
      id: 1,
      content: '用户不吃香菜',
      created_at: Math.floor(new Date('2026-05-01T08:00:00Z').getTime() / 1000),
      importance: 0.95,
      character_id: 'default',
      status: 'active',
    },
    {
      id: 2,
      content: '喜欢喝茶',
      created_at: Math.floor(new Date('2026-05-01T09:00:00Z').getTime() / 1000),
      importance: 0.4,
      character_id: 'default',
      status: 'active',
    },
  ],
  characters: [
    { id: 'default', name: '小夜', persona: '安静', user_nickname: '店长' },
  ],
  growthBeats: [
    {
      character_id: 'default',
      kind: 'episode',
      title: '海边的夏天',
      narrative: '十岁那年去了海边。',
      age: 10,
      status: 'committed',
      sort_order: 1,
    },
    {
      character_id: 'default',
      kind: 'reflection',
      title: '信念',
      narrative: '答应过的事要做到。',
      age: 12,
      status: 'committed',
      sort_order: 2,
    },
    {
      character_id: 'default',
      kind: 'episode',
      title: '草稿',
      narrative: '不该出现',
      age: 13,
      status: 'draft',
      sort_order: 3,
    },
  ],
  userProfile: { user_name: '小陈', user_persona: '怕香菜' },
  petConfig: { enabled: true, position_x: 12, position_y: 34, render_fps: 30 },
}

async function writeFakeDb(fromDir: string): Promise<void> {
  await mkdir(fromDir, { recursive: true })
  await writeFile(join(fromDir, 'kokoro.db'), 'fake-sqlite', 'utf8')
}

describe('import-kokoro', () => {
  it('maps memories / characters / growth / user profile and is idempotent', async () => {
    const dataDir = await tempDataDir()
    const fromDir = await tempDataDir('dsh-friend-kokoro-')
    await writeFakeDb(fromDir)
    await writeFile(join(fromDir, 'user_profile.json'), JSON.stringify(fixture.userProfile), 'utf8')
    await writeFile(join(fromDir, 'pet_config.json'), JSON.stringify(fixture.petConfig), 'utf8')
    const before = await stat(join(fromDir, 'kokoro.db'))

    const report = await importKokoro({
      fromDir,
      dataDir,
      openSqlite: () => snapshotDb(fixture),
    })

    expect(report.memories).toBe(2)
    expect(report.highlights).toBe(1)
    expect(report.characters).toBe(1)
    expect(report.growthEpisodes).toBe(1)
    expect(report.growthBeliefs).toBe(1)
    expect(report.userProfile).toBe(true)
    expect(report.petConfigMapped).toBe(true)
    expect(report.skipped.some((item) => item.reason === 'draft')).toBe(true)

    const store = new MemoryStore({ dataDir, slug: 'default' })
    const imported = await store.readDailyAnywhere('2026-05-01')
    expect(imported).toContain('[import] 用户不吃香菜')
    expect(imported).toContain('[import] 喜欢喝茶')
    expect(await store.readMemoryRaw()).toContain('导入精选')
    expect(await store.readMemoryRaw()).toContain('用户不吃香菜')
    expect(await store.readUserRaw()).toContain('小陈')

    const after = await stat(join(fromDir, 'kokoro.db'))
    expect(after.mtimeMs).toBe(before.mtimeMs)

    const second = await importKokoro({
      fromDir,
      dataDir,
      openSqlite: () => snapshotDb(fixture),
    })
    expect(second.memories).toBe(0)
    expect(second.skipped.filter((item) => item.reason === 'already-imported')).toHaveLength(2)
  })
})
