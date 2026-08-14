import { describe, expect, it, vi } from 'vitest'

import { createAutoSummary, summarizeTurn } from '../src/auto-summary.ts'
import { createMemoryLlm } from '../src/llm.ts'
import { DEFAULT_MEMORY_SETTINGS, type MemorySettings } from '../src/settings.ts'
import { MemoryStore } from '../src/store.ts'
import { tempDataDir } from './helpers/tmp.ts'

function llm(complete: (input: { user: string; system: string }) => Promise<string>) {
  return createMemoryLlm({
    resolveDeps: {
      getDefaultModel: () => ({ provider: 'test', model: 'summarize' }),
      getSettings: () => undefined,
    },
    complete: async (input) => complete(input),
  })
}

const turn = {
  sessionId: 'sess-1',
  turnId: 'turn-1',
  presetId: 'friend-companion',
  messages: [
    { role: 'user' as const, text: '记住我不吃香菜' },
    { role: 'assistant' as const, text: '好，记下了。' },
  ],
}

describe('auto-summary debounce and watermark', () => {
  it('waits for the idle window before writing [chat] notes', async () => {
    vi.useFakeTimers()
    const store = new MemoryStore({
      dataDir: await tempDataDir(),
      slug: 'default',
      now: () => new Date('2026-08-14T12:00:00'),
    })
    const handle = createAutoSummary({
      store,
      llm: llm(async () => '[{"fact":"用户不吃香菜"}]'),
      settings: () => ({ ...DEFAULT_MEMORY_SETTINGS, autoSummaryIdleMinutes: 10 }),
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
    })

    handle.notify(turn)
    await vi.advanceTimersByTimeAsync(9 * 60_000)
    expect(await store.readDailyRaw()).not.toContain('[chat]')
    await vi.advanceTimersByTimeAsync(60_000)
    await handle.flush()
    expect(await store.readDailyRaw()).toMatch(/\[chat\] 用户不吃香菜/)
    handle.dispose()
    vi.useRealTimers()
  })

  it('does not write when the switch is off', async () => {
    vi.useFakeTimers()
    const store = new MemoryStore({
      dataDir: await tempDataDir(),
      slug: 'default',
      now: () => new Date('2026-08-14T12:00:00'),
    })
    const settings = (): MemorySettings => ({ ...DEFAULT_MEMORY_SETTINGS, autoSummaryEnabled: false })
    const handle = createAutoSummary({
      store,
      llm: llm(async () => '[{"fact":"不该出现"}]'),
      settings,
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
    })
    handle.notify(turn)
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    await handle.flush()
    expect(await store.readDailyRaw()).toBe('')
    handle.dispose()
    vi.useRealTimers()
  })

  it('is idempotent for the same turn id', async () => {
    const store = new MemoryStore({
      dataDir: await tempDataDir(),
      slug: 'default',
      now: () => new Date('2026-08-14T12:00:00'),
    })
    const model = llm(async () => '[{"fact":"只写一次"}]')
    await summarizeTurn(store, model, turn)
    await summarizeTurn(store, model, turn)
    const raw = await store.readDailyRaw()
    expect(raw.match(/只写一次/g)?.length).toBe(1)
  })
})

describe('auto-summary LLM fault tolerance', () => {
  it('writes nothing on empty / illegal / oversized model output', async () => {
    const dataDir = await tempDataDir()
    const store = new MemoryStore({
      dataDir,
      slug: 'default',
      now: () => new Date('2026-08-14T12:00:00'),
    })

    await expect(summarizeTurn(store, llm(async () => '[]'), turn)).resolves.toMatchObject({
      wrote: false,
      reason: 'empty-facts',
    })
    await expect(summarizeTurn(store, llm(async () => 'not-json'), { ...turn, turnId: 't2' })).resolves.toMatchObject({
      wrote: false,
    })
    await expect(summarizeTurn(store, llm(async () => 'x'.repeat(5000)), { ...turn, turnId: 't3' })).resolves.toMatchObject({
      wrote: false,
      reason: 'oversized',
    })
    expect(await store.readDailyRaw()).toBe('')
  })
})
