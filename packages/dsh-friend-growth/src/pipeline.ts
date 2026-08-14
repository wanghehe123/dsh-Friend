import type { GrowthLlm } from './llm.ts'
import { runGrowthPrompt } from './llm.ts'
import { expandPrompts, outlinePrompts, reflectPrompts } from './prompts.ts'
import {
  createGrowthProgressSnapshot,
  type GrowthProgressSnapshot,
  type GrowthProgressTracker,
} from './progress.ts'
import {
  assignSortOrder,
  batchRanges,
  fillBeatsFromOutline,
  normalizeOutline,
  parseExpandResponse,
  parseOutlineResponse,
  parseReflectResponse,
  toGrowthBeat,
  type GrowthBeat,
  type GrowthNode,
  type GrowthProfile,
  type OutlineEvent,
  type ParsedBeat,
  type ReflectionResult,
} from './pure.ts'
import { withBatchLock, type GrowthStore, type GrowthWatermark } from './store.ts'

export type RunGrowthOptions = {
  store: GrowthStore
  llm: GrowthLlm
  batchId: string
  profile: GrowthProfile
  nodes?: readonly GrowthNode[]
  priorEpisodes?: readonly ParsedBeat[]
  progress?: GrowthProgressTracker
  onProgress?: (snapshot: GrowthProgressSnapshot) => void
}

export type RunGrowthResult = {
  batchId: string
  beats: GrowthBeat[]
  resumed: boolean
}

export async function runGrowthGeneration(options: RunGrowthOptions): Promise<RunGrowthResult> {
  return options.store.runWithCapturedDir(() =>
    withBatchLock(options.store, options.batchId, () => runLocked(options)),
  )
}

async function runLocked(options: RunGrowthOptions): Promise<RunGrowthResult> {
  const { store, llm, batchId, profile } = options
  const nodes = options.nodes ?? []
  const language = profile.language
  let existing = await store.readDraft(batchId)
  if (existing === undefined) {
    await store.initBatch({
      batchId,
      profile: { ...profile, status: 'drafting' },
      nodes,
    })
    existing = await store.readDraft(batchId)
  } else if (existing.profile.status !== 'drafting') {
    await store.writeProfile({ ...existing.profile, status: 'drafting' })
  }

  const emit = async (snapshot: GrowthProgressSnapshot): Promise<void> => {
    options.progress?.set(snapshot)
    options.onProgress?.(snapshot)
    // Must await: a fire-and-forget write races test cleanup (and can become
    // an unhandled rejection in production if the data dir disappears).
    try {
      await store.writeProgress(batchId, snapshot)
    } catch {
      // Progress is best-effort telemetry. Generation itself already persisted
      // outline / expand / reflect / watermark through awaited writes.
    }
  }

  const watermark = existing?.watermark ?? {
    stage: 'idle' as const,
    outlineDone: false,
    expandDone: [],
    reflectDone: false,
  }
  const resumed = watermark.outlineDone || watermark.expandDone.length > 0 || watermark.reflectDone

  try {
    const outline = await ensureOutline({
      store,
      llm,
      batchId,
      profile,
      nodes,
      language,
      watermark,
      existingOutline: existing?.outline ?? [],
      emit,
    })

    const ranges = batchRanges(outline.length)
    const episodes = await ensureExpand({
      store,
      llm,
      batchId,
      profile,
      language,
      outline,
      ranges,
      watermark,
      existingExpand: existing?.expand ?? [],
      priorEpisodes: options.priorEpisodes ?? [],
      emit,
    })

    const reflect = await ensureReflect({
      store,
      llm,
      batchId,
      profile,
      language,
      episodes,
      watermark,
      existingReflect: existing?.reflect,
      emit,
    })

    const drafts: ParsedBeat[] = [...episodes, ...reflect.reflections]
    const beats = drafts.map((draft, index) => toGrowthBeat({
      characterId: profile.characterId,
      batchId,
      draft,
      id: `${batchId}-${index}`,
      ...(profile.birthYear !== undefined ? { birthYear: profile.birthYear } : {}),
    }))
    assignSortOrder(beats)
    await store.writeBeats(batchId, beats)
    if (reflect.lifeStorySummary.length > 0) {
      const current = await store.readProfile()
      if (current !== undefined) {
        await store.writeProfile({
          ...current,
          status: 'drafting',
          lifeStorySummary: reflect.lifeStorySummary,
        })
      }
    }
    await store.writeWatermark(batchId, {
      stage: 'complete',
      outlineDone: true,
      expandDone: ranges.map((_, index) => index),
      reflectDone: true,
    })
    await emit(createGrowthProgressSnapshot({
      phase: 'complete',
      current: beats.length,
      total: beats.length,
      message: `generated ${beats.length} growth beats`,
      batchId,
    }))
    return { batchId, beats, resumed }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await emit(createGrowthProgressSnapshot({
      phase: 'error',
      current: 0,
      total: 0,
      message,
      batchId,
      error: message,
    }))
    throw error
  }
}

async function ensureOutline(input: {
  store: GrowthStore
  llm: GrowthLlm
  batchId: string
  profile: GrowthProfile
  nodes: readonly GrowthNode[]
  language: string
  watermark: GrowthWatermark
  existingOutline: OutlineEvent[]
  emit: (snapshot: GrowthProgressSnapshot) => Promise<void>
}): Promise<OutlineEvent[]> {
  if (input.watermark.outlineDone && input.existingOutline.length > 0) {
    return input.existingOutline
  }
  await input.emit(createGrowthProgressSnapshot({
    phase: 'outline',
    current: 0,
    total: 1,
    message: 'sketching chronological life outline',
    batchId: input.batchId,
  }))
  const prompts = outlinePrompts(input.profile, input.nodes, input.language)
  const raw = await runGrowthPrompt(input.llm, {
    stage: 'outline',
    system: prompts.system,
    user: prompts.user,
    temperature: 0.7,
  })
  const events = normalizeOutline(parseOutlineResponse(raw), input.profile.currentAge)
  if (events.length === 0) {
    throw new Error('growth outline produced no usable events after age filtering')
  }
  await input.store.writeOutline(input.batchId, events)
  await input.store.writeWatermark(input.batchId, {
    ...input.watermark,
    stage: 'outline',
    outlineDone: true,
  })
  await input.emit(createGrowthProgressSnapshot({
    phase: 'outline',
    current: 1,
    total: 1,
    message: `outlined ${events.length} events`,
    batchId: input.batchId,
  }))
  return events
}

async function ensureExpand(input: {
  store: GrowthStore
  llm: GrowthLlm
  batchId: string
  profile: GrowthProfile
  language: string
  outline: OutlineEvent[]
  ranges: Array<[number, number]>
  watermark: GrowthWatermark
  existingExpand: ParsedBeat[][]
  priorEpisodes: readonly ParsedBeat[]
  emit: (snapshot: GrowthProgressSnapshot) => Promise<void>
}): Promise<ParsedBeat[]> {
  const batchTotal = Math.max(1, input.ranges.length)
  const episodes: ParsedBeat[] = [...input.priorEpisodes]
  const done = new Set(input.watermark.expandDone)

  for (const [index, range] of input.ranges.entries()) {
    const [start, end] = range
    const batch = input.outline.slice(start, end)
    if (done.has(index) || await input.store.expandBatchExists(input.batchId, index)) {
      const cached = input.existingExpand[index] ?? []
      episodes.push(...cached)
      done.add(index)
      continue
    }
    await input.emit(createGrowthProgressSnapshot({
      phase: 'expand',
      current: index,
      total: batchTotal,
      message: `expanding batch ${index + 1}/${batchTotal}`,
      batchId: input.batchId,
    }))
    const prompts = expandPrompts(input.profile, batch, episodes, input.language)
    const raw = await runGrowthPrompt(input.llm, {
      stage: 'expand',
      system: prompts.system,
      user: prompts.user,
      temperature: 0.85,
    })
    const beats = parseExpandResponse(raw)
    fillBeatsFromOutline(beats, batch)
    await input.store.writeExpandBatch(input.batchId, index, beats)
    done.add(index)
    await input.store.writeWatermark(input.batchId, {
      stage: 'expand',
      outlineDone: true,
      expandDone: [...done].sort((left, right) => left - right),
      reflectDone: false,
    })
    episodes.push(...beats)
    await input.emit(createGrowthProgressSnapshot({
      phase: 'expand',
      current: index + 1,
      total: batchTotal,
      message: `expanded batch ${index + 1}/${batchTotal}`,
      batchId: input.batchId,
    }))
  }
  return episodes.slice(input.priorEpisodes.length)
}

async function ensureReflect(input: {
  store: GrowthStore
  llm: GrowthLlm
  batchId: string
  profile: GrowthProfile
  language: string
  episodes: ParsedBeat[]
  watermark: GrowthWatermark
  existingReflect: ReflectionResult | undefined
  emit: (snapshot: GrowthProgressSnapshot) => Promise<void>
}): Promise<ReflectionResult> {
  if (input.watermark.reflectDone && input.existingReflect !== undefined) {
    return input.existingReflect
  }
  await input.emit(createGrowthProgressSnapshot({
    phase: 'reflect',
    current: 0,
    total: 1,
    message: 'distilling core beliefs',
    batchId: input.batchId,
  }))
  if (input.episodes.length === 0) {
    const empty = { reflections: [], lifeStorySummary: '' }
    await input.store.writeReflect(input.batchId, empty)
    return empty
  }
  const prompts = reflectPrompts(input.profile, input.episodes, input.language)
  const raw = await runGrowthPrompt(input.llm, {
    stage: 'reflect',
    system: prompts.system,
    user: prompts.user,
    temperature: 0.5,
  })
  const result = parseReflectResponse(raw)
  await input.store.writeReflect(input.batchId, result)
  await input.store.writeWatermark(input.batchId, {
    stage: 'reflect',
    outlineDone: true,
    expandDone: input.watermark.expandDone,
    reflectDone: true,
  })
  await input.emit(createGrowthProgressSnapshot({
    phase: 'reflect',
    current: 1,
    total: 1,
    message: 'reflection complete',
    batchId: input.batchId,
  }))
  return result
}

export function newBatchId(now = Date.now()): string {
  return `b${now.toString(36)}`
}
