import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyDistillGuards,
  distillMemory,
  nextDistillAt,
  parseDistillOutput,
  scheduleDistill,
} from '../src/distill.ts'
import { createMemoryLlm } from '../src/llm.ts'
import { DEFAULT_MEMORY_SETTINGS } from '../src/settings.ts'
import {
  parseMemoryMarkdown,
  serializeMemoryMarkdown,
  MemoryStore,
} from '../src/store.ts'
import { tempDataDir } from './helpers/tmp.ts'

function llm(complete: () => Promise<string>) {
  return createMemoryLlm({
    resolveDeps: {
      getDefaultModel: () => ({ provider: 'test', model: 'summarize' }),
      getSettings: () => undefined,
    },
    complete: async () => complete(),
  })
}

const goodOutput = [
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
].join('\n')

describe('distill guardrails', () => {
  it('keeps facts marked 重要 even if the model drops them', () => {
    const previous = parseMemoryMarkdown([
      '## 关于用户',
      '',
      '## 重要事实',
      '',
      '- 不吃香菜（重要）',
      '',
      '## 近期主题',
      '',
      '## 待办与约定',
      '',
    ].join('\n'))
    const next = parseMemoryMarkdown([
      '## 关于用户',
      '',
      '## 重要事实',
      '',
      '- 喜欢喝茶',
      '',
      '## 近期主题',
      '',
      '## 待办与约定',
      '',
    ].join('\n'))
    const guarded = applyDistillGuards(previous, next, 8 * 1024)
    expect(guarded.status).toBe('ok')
    if (guarded.status === 'ok') {
      expect(serializeMemoryMarkdown(guarded.document)).toContain('香菜')
    }
  })

  it('keeps both sides of a dated contradiction when the model follows the rule', () => {
    const parsed = parseDistillOutput([
      '## 关于用户',
      '',
      '## 重要事实',
      '',
      '- 2026-07-01 说住北京',
      '- 2026-08-01 说已搬去上海',
      '',
      '## 近期主题',
      '',
      '## 待办与约定',
      '',
    ].join('\n'))
    expect(parsed?.sections['重要事实']).toContain('北京')
    expect(parsed?.sections['重要事实']).toContain('上海')
  })

  it('compresses over-limit output without dropping 重要 facts', () => {
    const previous = parseMemoryMarkdown('## 重要事实\n\n- 关键事实（重要）\n')
    const next = parseMemoryMarkdown([
      '## 关于用户',
      '',
      `- ${'闲聊'.repeat(200)}`,
      '',
      '## 重要事实',
      '',
      '- 关键事实（重要）',
      '',
      '## 近期主题',
      '',
      `- ${'主题'.repeat(200)}`,
      '',
      '## 待办与约定',
      '',
    ].join('\n'))
    const guarded = applyDistillGuards(previous, next, 800)
    expect(guarded.status).toBe('ok')
    if (guarded.status === 'ok') {
      const text = serializeMemoryMarkdown(guarded.document)
      expect(text).toContain('关键事实')
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(800)
    }
  })

  it('rolls back MEMORY.md when the model returns garbage', async () => {
    const store = new MemoryStore({
      dataDir: await tempDataDir(),
      slug: 'default',
      now: () => new Date('2026-08-14T12:00:00'),
      memoryMaxBytes: 8 * 1024,
    })
    await store.appendLongterm('原有事实（重要）')
    const before = await store.readMemoryRaw()

    const result = await distillMemory({
      store,
      llm: llm(async () => '<<<not markdown>>>'),
      settings: () => DEFAULT_MEMORY_SETTINGS,
    })

    expect(result.status).toBe('rolled-back')
    expect(result.reason).toBe('corrupt-output')
    expect(await store.readMemoryRaw()).toBe(before)
    expect(await store.listBackupIndexes()).toContain(1)
  })

  it('writes a complete new MEMORY.md on success and adds a backup', async () => {
    const store = new MemoryStore({
      dataDir: await tempDataDir(),
      slug: 'default',
      now: () => new Date('2026-08-14T12:00:00'),
    })
    await store.appendLongterm('旧事实（重要）')
    await store.appendDaily({ text: '新约定', source: 'chat' })
    const backupsBefore = (await store.listBackupIndexes()).length

    const result = await distillMemory({
      store,
      llm: llm(async () => goodOutput),
      settings: () => DEFAULT_MEMORY_SETTINGS,
    })

    expect(result.status).toBe('ok')
    expect((await store.listBackupIndexes()).length).toBe(backupsBefore + 1)
    expect(await store.measureMemoryBytes()).toBeLessThanOrEqual(8 * 1024)
    expect(await store.readMemoryRaw()).toContain('不吃香菜')
  })

  it('does not leave a torn MEMORY.md when rename is interrupted', async () => {
    const store = new MemoryStore({
      dataDir: await tempDataDir(),
      slug: 'default',
      now: () => new Date('2026-08-14T12:00:00'),
    })
    await store.appendLongterm('完整旧版（重要）')
    const before = await store.readMemoryRaw()
    await expect(store.writeMemoryRaw(goodOutput, {
      beforeRename: () => {
        throw new Error('killed')
      },
    })).rejects.toThrow(/killed/)
    expect(await store.readMemoryRaw()).toBe(before)
  })
})

describe('distill schedule', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires at the next configured clock (fake timers)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T03:00:00'))
    const ran: number[] = []
    const stop = scheduleDistill({
      hour: 4,
      minute: 0,
      now: () => new Date(),
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
      watchIntervalMs: 0,
      run: () => {
        ran.push(Date.now())
      },
    })
    const next = nextDistillAt(new Date('2026-08-14T03:00:00'), 4, 0)
    expect(next.getHours()).toBe(4)
    expect(next.getMinutes()).toBe(0)
    await vi.advanceTimersByTimeAsync(60 * 60_000 + 10)
    expect(ran.length).toBeGreaterThanOrEqual(1)
    stop()
  })

  it('re-arms when the clock changes so the old hour does not fire', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T03:00:00'))
    let hour = 4
    const ran: number[] = []
    const stop = scheduleDistill({
      hour: () => hour,
      minute: 0,
      now: () => new Date(),
      watchIntervalMs: 1_000,
      run: () => {
        ran.push(Date.now())
      },
    })
    hour = 5
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(ran).toEqual([])
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(ran).toHaveLength(1)
    expect(new Date(ran[0] ?? 0).getHours()).toBe(5)
    stop()
  })

  it('does not run at the old clock when hour changed before fire (no watch)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T03:00:00'))
    let hour = 4
    const ran: number[] = []
    const stop = scheduleDistill({
      hour: () => hour,
      minute: 0,
      now: () => new Date(),
      watchIntervalMs: 0,
      run: () => {
        ran.push(Date.now())
      },
    })
    hour = 5
    await vi.advanceTimersByTimeAsync(60 * 60_000 + 10)
    expect(ran).toEqual([])
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(ran).toHaveLength(1)
    stop()
  })

  it('does not fire after dispose', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T03:00:00'))
    const ran: number[] = []
    const stop = scheduleDistill({
      hour: 4,
      minute: 0,
      now: () => new Date(),
      watchIntervalMs: 1_000,
      run: () => {
        ran.push(Date.now())
      },
    })
    stop()
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000)
    expect(ran).toEqual([])
  })
})
