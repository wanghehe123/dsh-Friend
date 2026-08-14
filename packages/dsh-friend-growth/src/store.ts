import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { lockedAtomicWrite, withFileLock, type AtomicWriteHooks } from './atomic.ts'
import {
  assertSafeSlug,
  assertSafeBatchId,
  growthBatchDir,
  growthCurrentPath,
  growthPreferencesPath,
  growthProfilePath,
  growthRoot,
} from './paths.ts'
import type { GrowthProgressSnapshot } from './progress.ts'
import {
  type GrowthBeat,
  type GrowthNode,
  type GrowthProfile,
  type OutlineEvent,
  type ParsedBeat,
  type ReflectionResult,
} from './pure.ts'

export type GrowthWatermark = {
  stage: 'idle' | 'outline' | 'expand' | 'reflect' | 'complete' | 'failed'
  outlineDone: boolean
  expandDone: number[]
  reflectDone: boolean
}

export type GrowthCurrent = {
  batchId: string
}

export type GrowthPreferences = {
  language?: string
  model?: unknown
}

export type GrowthDraft = {
  batchId: string
  profile: GrowthProfile
  nodes: GrowthNode[]
  outline: OutlineEvent[]
  expand: ParsedBeat[][]
  reflect?: ReflectionResult
  beats: GrowthBeat[]
  excluded: string[]
  watermark: GrowthWatermark
  progress?: GrowthProgressSnapshot
}

const EMPTY_WATERMARK: GrowthWatermark = {
  stage: 'idle',
  outlineDone: false,
  expandDone: [],
  reflectDone: false,
}

const growthIo = new AsyncLocalStorage<string>()

export class GrowthStore {
  readonly dataDir: string
  private readonly resolveSlugFn: () => string

  constructor(options: { dataDir: string; slug: string | (() => string) }) {
    this.dataDir = options.dataDir
    this.resolveSlugFn = () => {
      const slug = typeof options.slug === 'function' ? options.slug() : options.slug
      assertSafeSlug(slug)
      return slug
    }
    this.resolveSlugFn()
  }

  /**
   * Effective character slug: pinned in-flight directory, otherwise the
   * live settings value.
   */
  get slug(): string {
    return growthIo.getStore() ?? this.resolveSlugFn()
  }

  /**
   * Snapshot the character directory for `work` and every nested store call.
   * Re-entrant so generate / commit cannot split a draft across two slugs.
   */
  runWithCapturedDir<T>(work: () => Promise<T>): Promise<T> {
    const existing = growthIo.getStore()
    if (existing !== undefined) {
      return work()
    }
    return growthIo.run(this.resolveSlugFn(), work)
  }

  batchDir(batchId: string): string {
    return growthBatchDir(this.dataDir, this.slug, batchId)
  }

  async readProfile(): Promise<GrowthProfile | undefined> {
    return this.runWithCapturedDir(() => readJson(growthProfilePath(this.dataDir, this.slug)))
  }

  async writeProfile(profile: GrowthProfile, hooks: AtomicWriteHooks = {}): Promise<void> {
    return this.runWithCapturedDir(() => lockedAtomicWrite(
      growthProfilePath(this.dataDir, this.slug),
      `${JSON.stringify(profile, null, 2)}\n`,
      hooks,
    ))
  }

  async readCurrent(): Promise<GrowthCurrent | undefined> {
    return this.runWithCapturedDir(() => readJson(growthCurrentPath(this.dataDir, this.slug)))
  }

  async writeCurrent(current: GrowthCurrent): Promise<void> {
    return this.runWithCapturedDir(() => lockedAtomicWrite(
      growthCurrentPath(this.dataDir, this.slug),
      `${JSON.stringify(current, null, 2)}\n`,
    ))
  }

  async readPreferences(): Promise<GrowthPreferences> {
    return this.runWithCapturedDir(async () => (
      (await readJson<GrowthPreferences>(growthPreferencesPath(this.dataDir, this.slug))) ?? {}
    ))
  }

  async writePreferences(prefs: GrowthPreferences): Promise<void> {
    return this.runWithCapturedDir(() => lockedAtomicWrite(
      growthPreferencesPath(this.dataDir, this.slug),
      `${JSON.stringify(prefs, null, 2)}\n`,
    ))
  }

  async listBatchIds(): Promise<string[]> {
    return this.runWithCapturedDir(async () => {
      const root = growthRoot(this.dataDir, this.slug)
      let entries
      try {
        entries = await readdir(root, { withFileTypes: true })
      } catch {
        return []
      }
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    })
  }

  async initBatch(input: {
    batchId: string
    profile: GrowthProfile
    nodes?: readonly GrowthNode[]
  }): Promise<void> {
    return this.runWithCapturedDir(async () => {
      assertSafeBatchId(input.batchId)
      await mkdir(this.batchDir(input.batchId), { recursive: true })
      await this.writeJson(input.batchId, 'meta.json', {
        profile: input.profile,
        nodes: input.nodes ?? [],
      })
      await this.writeWatermark(input.batchId, EMPTY_WATERMARK)
      await this.writeExcluded(input.batchId, [])
      await this.writeCurrent({ batchId: input.batchId })
      await this.writeProfile(input.profile)
    })
  }

  async readDraft(batchId: string): Promise<GrowthDraft | undefined> {
    return this.runWithCapturedDir(async () => {
      const meta = await this.readJson<{ profile: GrowthProfile; nodes: GrowthNode[] }>(
        batchId,
        'meta.json',
      )
      if (meta === undefined) {
        return undefined
      }
      const outline = (await this.readJson<OutlineEvent[]>(batchId, 'outline.json')) ?? []
      const expand = await this.readExpandBatches(batchId)
      const reflect = await this.readJson<ReflectionResult>(batchId, 'reflect.json')
      const beats = (await this.readJson<GrowthBeat[]>(batchId, 'beats.json')) ?? []
      const excluded = (await this.readJson<string[]>(batchId, 'excluded.json')) ?? []
      const watermark = (await this.readJson<GrowthWatermark>(batchId, 'watermark.json')) ?? EMPTY_WATERMARK
      const progress = await this.readJson<GrowthProgressSnapshot>(batchId, 'progress.json')
      const draft: GrowthDraft = {
        batchId,
        profile: meta.profile,
        nodes: meta.nodes,
        outline,
        expand,
        beats,
        excluded,
        watermark,
      }
      if (reflect !== undefined) {
        draft.reflect = reflect
      }
      if (progress !== undefined) {
        draft.progress = progress
      }
      return draft
    })
  }

  async writeOutline(batchId: string, outline: readonly OutlineEvent[]): Promise<void> {
    return this.runWithCapturedDir(() => this.writeJson(batchId, 'outline.json', outline))
  }

  async writeExpandBatch(batchId: string, index: number, beats: readonly ParsedBeat[]): Promise<void> {
    return this.runWithCapturedDir(async () => {
      await mkdir(join(this.batchDir(batchId), 'expand'), { recursive: true })
      await lockedAtomicWrite(
        join(this.batchDir(batchId), 'expand', `${index}.json`),
        `${JSON.stringify(beats, null, 2)}\n`,
      )
    })
  }

  async expandBatchExists(batchId: string, index: number): Promise<boolean> {
    return this.runWithCapturedDir(() => pathExists(join(this.batchDir(batchId), 'expand', `${index}.json`)))
  }

  async writeReflect(batchId: string, result: ReflectionResult): Promise<void> {
    return this.runWithCapturedDir(() => this.writeJson(batchId, 'reflect.json', result))
  }

  async writeBeats(batchId: string, beats: readonly GrowthBeat[]): Promise<void> {
    return this.runWithCapturedDir(() => this.writeJson(batchId, 'beats.json', beats))
  }

  async writeExcluded(batchId: string, ids: readonly string[]): Promise<void> {
    return this.runWithCapturedDir(() => this.writeJson(batchId, 'excluded.json', [...ids]))
  }

  async writeWatermark(batchId: string, watermark: GrowthWatermark): Promise<void> {
    return this.runWithCapturedDir(() => this.writeJson(batchId, 'watermark.json', watermark))
  }

  async writeProgress(batchId: string, snapshot: GrowthProgressSnapshot): Promise<void> {
    return this.runWithCapturedDir(() => this.writeJson(batchId, 'progress.json', snapshot))
  }

  async readWatermark(batchId: string): Promise<GrowthWatermark> {
    return this.runWithCapturedDir(async () => (
      (await this.readJson<GrowthWatermark>(batchId, 'watermark.json')) ?? EMPTY_WATERMARK
    ))
  }

  private async readExpandBatches(batchId: string): Promise<ParsedBeat[][]> {
    const dir = join(this.batchDir(batchId), 'expand')
    let entries
    try {
      entries = await readdir(dir)
    } catch {
      return []
    }
    const indexes = entries
      .map((name) => /^(\d+)\.json$/u.exec(name)?.[1])
      .filter((value): value is string => value !== undefined)
      .map((value) => Number(value))
      .sort((left, right) => left - right)
    if (indexes.length === 0) {
      return []
    }
    const max = indexes[indexes.length - 1] ?? 0
    const batches: ParsedBeat[][] = []
    for (let index = 0; index <= max; index += 1) {
      const beats = await readJson<ParsedBeat[]>(join(dir, `${index}.json`))
      batches[index] = beats ?? []
    }
    return batches
  }

  private async writeJson(batchId: string, file: string, value: unknown): Promise<void> {
    await lockedAtomicWrite(
      join(this.batchDir(batchId), file),
      `${JSON.stringify(value, null, 2)}\n`,
    )
  }

  private async readJson<T>(batchId: string, file: string): Promise<T | undefined> {
    return readJson(join(this.batchDir(batchId), file))
  }
}

export async function withBatchLock<T>(
  store: GrowthStore,
  batchId: string,
  work: () => Promise<T>,
): Promise<T> {
  return withFileLock(join(store.batchDir(batchId), '.lock'), work)
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    const raw = await readFile(path, 'utf8')
    if (raw.trim().length === 0) {
      return undefined
    }
    return JSON.parse(raw) as T
  } catch (error) {
    if (isEnoent(error)) {
      return undefined
    }
    throw error
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isEnoent(error)) {
      return false
    }
    throw error
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT'
}
