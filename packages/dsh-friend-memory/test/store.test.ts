import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  MemoryLimitError,
  MemoryStore,
  parseMemoryMarkdown,
  serializeMemoryMarkdown,
} from '../src/store.ts'
import { tempDataDir } from './helpers/tmp.ts'

function storeAt(dataDir: string, now = new Date('2026-08-14T12:00:00')): MemoryStore {
  return new MemoryStore({ dataDir, slug: 'default', now: () => now, memoryMaxBytes: 8 * 1024 })
}

describe('MEMORY.md section parse/serialize', () => {
  it('round-trips the four fixed sections and keeps extra user headings', () => {
    const raw = [
      '手写前言',
      '',
      '## 关于用户',
      '',
      '- 叫小陈',
      '',
      '## 重要事实',
      '',
      '- 不吃香菜（重要）',
      '',
      '## 近期主题',
      '',
      '- 搬家',
      '',
      '## 待办与约定',
      '',
      '- 周日喝茶',
      '',
      '## 导入精选',
      '',
      '- 旧库事实',
      '',
    ].join('\n')

    const parsed = parseMemoryMarkdown(raw)
    expect(parsed.preamble).toContain('手写前言')
    expect(parsed.sections['关于用户']).toContain('小陈')
    expect(parsed.sections['重要事实']).toContain('香菜')
    expect(parsed.sections['近期主题']).toContain('搬家')
    expect(parsed.sections['待办与约定']).toContain('喝茶')
    expect(parsed.extras).toEqual([{ title: '导入精选', body: '- 旧库事实' }])

    const again = parseMemoryMarkdown(serializeMemoryMarkdown(parsed))
    expect(again.sections).toEqual(parsed.sections)
    expect(again.extras).toEqual(parsed.extras)
    expect(again.preamble).toContain('手写前言')
  })
})

describe('MemoryStore daily append', () => {
  it('appends a timestamped note and keeps both concurrent writers', async () => {
    const dataDir = await tempDataDir()
    const store = storeAt(dataDir)

    await Promise.all([
      store.appendDaily({ text: '自动小结一条', source: 'chat' }),
      store.appendDaily({ text: '工具记下忌口', source: 'note' }),
    ])

    const raw = await store.readDailyRaw('2026-08-14')
    expect(raw).toMatch(/- 12:00 \[chat\] 自动小结一条/)
    expect(raw).toMatch(/- 12:00 \[note\] 工具记下忌口/)
    expect(raw).not.toMatch(/\[chat\].*\[note\]/)
  })

  it('writes longterm facts into 重要事实', async () => {
    const dataDir = await tempDataDir()
    const store = storeAt(dataDir)
    await store.appendLongterm('不吃香菜')
    const parsed = await store.readMemory()
    expect(parsed.sections['重要事实']).toContain('不吃香菜')
  })
})

describe('volume limit and archive / backup', () => {
  it('detects MEMORY.md over the byte limit and refuses the write', async () => {
    const dataDir = await tempDataDir()
    const store = new MemoryStore({
      dataDir,
      slug: 'default',
      memoryMaxBytes: 80,
      now: () => new Date('2026-08-14T12:00:00'),
    })
    await expect(store.writeMemoryRaw('# huge\n' + 'x'.repeat(200))).rejects.toBeInstanceOf(MemoryLimitError)
    expect(await store.readMemoryRaw()).toBe('')
  })

  it('moves last-last-month daily notes into archive/YYYY-MM/', async () => {
    const dataDir = await tempDataDir()
    const store = storeAt(dataDir, new Date('2026-08-14T12:00:00'))
    await store.appendDaily({ text: '六月的事', source: 'note', date: '2026-06-03' })
    await store.appendDaily({ text: '七月的事', source: 'note', date: '2026-07-20' })
    await store.appendDaily({ text: '今天的事', source: 'note', date: '2026-08-14' })

    const moved = await store.archiveOldNotes()
    expect(moved).toEqual(['2026-06-03'])
    await expect(readFile(join(dataDir, 'characters/default/memory/archive/2026-06/2026-06-03.md'), 'utf8'))
      .resolves.toContain('六月的事')
    await expect(readFile(join(dataDir, 'characters/default/memory/2026-07-20.md'), 'utf8'))
      .resolves.toContain('七月的事')
  })

  it('rotates MEMORY.md.bak.N and keeps at most 7', async () => {
    const dataDir = await tempDataDir()
    const store = storeAt(dataDir)
    await store.appendLongterm('v1')
    for (let index = 0; index < 8; index += 1) {
      await store.rotateBackups()
      await store.appendLongterm(`v${index + 2}`)
    }
    const backups = await store.listBackupIndexes()
    expect(backups).toEqual([1, 2, 3, 4, 5, 6, 7])
    const names = await readdir(join(dataDir, 'characters/default'))
    expect(names.filter((name) => name.startsWith('MEMORY.md.bak.')).sort()).toEqual([
      'MEMORY.md.bak.1',
      'MEMORY.md.bak.2',
      'MEMORY.md.bak.3',
      'MEMORY.md.bak.4',
      'MEMORY.md.bak.5',
      'MEMORY.md.bak.6',
      'MEMORY.md.bak.7',
    ])
  })
})

describe('no dirty cache / crash safety', () => {
  it('rereads MEMORY.md from disk after an external editor change', async () => {
    const dataDir = await tempDataDir()
    const store = storeAt(dataDir)
    await store.appendLongterm('旧事实')
    const path = store.memoryPath()
    const current = await readFile(path, 'utf8')
    await writeFile(path, current.replace('旧事实', '手改后的新事实'), 'utf8')
    const parsed = await store.readMemory()
    expect(parsed.sections['重要事实']).toContain('手改后的新事实')
    expect(parsed.sections['重要事实']).not.toContain('旧事实')
  })

  it('leaves MEMORY.md intact when the write is interrupted before rename', async () => {
    const dataDir = await tempDataDir()
    const store = storeAt(dataDir)
    await store.appendLongterm('不能丢')
    const before = await store.readMemoryRaw()

    await expect(store.writeMemoryRaw('半写损坏', {
      beforeRename: async (tmpPath) => {
        await expect(readFile(tmpPath, 'utf8')).resolves.toContain('半写损坏')
        throw new Error('simulated crash')
      },
    })).rejects.toThrow(/simulated crash/)

    expect(await store.readMemoryRaw()).toBe(before)
    expect(await store.readMemoryRaw()).toContain('不能丢')
    expect(await store.readMemoryRaw()).not.toContain('半写损坏')
  })
})

describe('live slug and memoryMaxBytes', () => {
  it('writes the new character directory after currentSlug changes and keeps the old one', async () => {
    const dataDir = await tempDataDir()
    let slug = 'alice'
    const store = new MemoryStore({
      dataDir,
      slug: () => slug,
      now: () => new Date('2026-08-14T12:00:00'),
      memoryMaxBytes: 8 * 1024,
    })
    await store.appendLongterm('alice-fact')
    slug = 'bob'
    await store.appendLongterm('bob-fact')

    const alice = await readFile(join(dataDir, 'characters/alice/MEMORY.md'), 'utf8')
    const bob = await readFile(join(dataDir, 'characters/bob/MEMORY.md'), 'utf8')
    expect(alice).toContain('alice-fact')
    expect(alice).not.toContain('bob-fact')
    expect(bob).toContain('bob-fact')
    expect(bob).not.toContain('alice-fact')
  })

  it('keeps an in-flight write on the start slug when currentSlug flips mid-rename', async () => {
    const dataDir = await tempDataDir()
    let slug = 'alice'
    const store = new MemoryStore({
      dataDir,
      slug: () => slug,
      now: () => new Date('2026-08-14T12:00:00'),
      memoryMaxBytes: 8 * 1024,
    })
    await store.appendLongterm('alice-old')

    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = store.writeMemoryRaw('## 重要事实\n\n- alice-inflight\n', {
      beforeRename: () => gate,
    })
    slug = 'bob'
    await store.appendLongterm('bob-fact')
    release()
    await pending

    const alice = await readFile(join(dataDir, 'characters/alice/MEMORY.md'), 'utf8')
    const bob = await readFile(join(dataDir, 'characters/bob/MEMORY.md'), 'utf8')
    expect(alice).toContain('alice-inflight')
    expect(alice).not.toContain('bob-fact')
    expect(bob).toContain('bob-fact')
    expect(bob).not.toContain('alice-inflight')
    expect(bob).not.toContain('alice-old')
  })

  it('re-reads memoryMaxBytes on the next write and keeps the in-flight limit', async () => {
    const dataDir = await tempDataDir()
    let maxBytes = 8 * 1024
    const store = new MemoryStore({
      dataDir,
      slug: 'default',
      now: () => new Date('2026-08-14T12:00:00'),
      memoryMaxBytes: () => maxBytes,
    })
    const bulky = `# huge\n${'x'.repeat(200)}`
    expect(store.memoryMaxBytes).toBe(8 * 1024)

    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = store.writeMemoryRaw(bulky, { beforeRename: () => gate })
    maxBytes = 80
    expect(store.memoryMaxBytes).toBe(80)
    await expect(store.writeMemoryRaw(`${bulky}y`)).rejects.toBeInstanceOf(MemoryLimitError)
    release()
    await pending
    expect(await store.readMemoryRaw()).toBe(bulky)
  })
})
