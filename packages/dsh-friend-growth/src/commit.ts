import { readFile } from 'node:fs/promises'

import { lockedAtomicWrite, type AtomicWriteHooks } from './atomic.ts'
import { beliefsFilePath, memoryFilePath, storyFilePath } from './paths.ts'
import {
  composeMemoryContent,
  type GrowthBeat,
  type GrowthProfile,
} from './pure.ts'
import { writeMemoryTheme } from './memory-md.ts'
import { selectedBeats } from './ui-state.ts'
import type { GrowthStore } from './store.ts'

export type CommitGrowthOptions = {
  store: GrowthStore
  batchId: string
  excludedIds?: readonly string[]
  hooks?: {
    beforeStory?: AtomicWriteHooks['beforeRename']
    beforeBeliefs?: AtomicWriteHooks['beforeRename']
    beforeMemory?: AtomicWriteHooks['beforeRename']
  }
}

export type CommitGrowthResult = {
  batchId: string
  storyPath: string
  beliefsPath: string
  memoryPath: string
  story: string
  beliefs: string
  committed: GrowthBeat[]
}

export function renderStoryInner(beats: readonly GrowthBeat[]): string {
  return beats
    .filter((beat) => beat.kind !== 'reflection')
    .map((beat) => `### ${beat.title}\n\n${composeMemoryContent(beat)}\n`)
    .join('\n')
    .trimEnd()
}

export function renderBeliefsInner(beats: readonly GrowthBeat[]): string {
  return beats
    .filter((beat) => beat.kind === 'reflection')
    .map((beat) => `### ${beat.title}\n\n${composeMemoryContent(beat)}\n`)
    .join('\n')
    .trimEnd()
}

export function renderStoryMarkdown(beats: readonly GrowthBeat[], batchId: string): string {
  return `# 人生故事\n\n${wrapBatch(batchId, renderStoryInner(beats))}\n`
}

export function renderBeliefsMarkdown(beats: readonly GrowthBeat[], batchId: string): string {
  return `# 信念\n\n${wrapBatch(batchId, renderBeliefsInner(beats))}\n`
}

function upsertTitledDocument(
  existing: string,
  title: string,
  batchId: string,
  inner: string,
): string {
  const heading = new RegExp(`^# ${escapeRegExp(title)}\\s*`, 'u')
  const stripped = existing.replace(heading, '')
  const merged = upsertBatchSection(stripped, batchId, wrapBatch(batchId, inner))
  return `# ${title}\n\n${merged.trim()}\n`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

export function wrapBatch(batchId: string, body: string): string {
  return `<!-- growth-batch:${batchId} -->\n${body}\n<!-- /growth-batch:${batchId} -->`
}

export function upsertBatchSection(existing: string, batchId: string, rendered: string): string {
  const open = `<!-- growth-batch:${batchId} -->`
  const close = `<!-- /growth-batch:${batchId} -->`
  const start = existing.indexOf(open)
  if (start < 0) {
    const trimmed = existing.trim()
    return trimmed.length === 0 ? rendered : `${trimmed}\n\n${rendered}`
  }
  const end = existing.indexOf(close, start)
  if (end < 0) {
    return `${existing.slice(0, start).trimEnd()}\n\n${rendered}`.trim() + '\n'
  }
  const before = existing.slice(0, start).trimEnd()
  const after = existing.slice(end + close.length).trimStart()
  return `${[before, rendered.trim(), after].filter((part) => part.length > 0).join('\n\n')}\n`
}

export async function commitGrowthDraft(options: CommitGrowthOptions): Promise<CommitGrowthResult> {
  return options.store.runWithCapturedDir(() => commitCaptured(options))
}

async function commitCaptured(options: CommitGrowthOptions): Promise<CommitGrowthResult> {
  const draft = await options.store.readDraft(options.batchId)
  if (draft === undefined) {
    throw new Error(`dsh-friend-growth: draft ${options.batchId} is missing`)
  }
  if (options.excludedIds !== undefined) {
    await options.store.writeExcluded(options.batchId, options.excludedIds)
  }
  const excluded = options.excludedIds ?? draft.excluded
  const committed = selectedBeats(draft.beats, excluded)
  const dataDir = options.store.dataDir
  const slug = options.store.slug
  const storyPath = storyFilePath(dataDir, slug)
  const beliefsPath = beliefsFilePath(dataDir, slug)
  const memPath = memoryFilePath(dataDir, slug)

  const story = upsertTitledDocument(
    await readUtf8(storyPath),
    '人生故事',
    options.batchId,
    renderStoryInner(committed),
  )
  const beliefs = upsertTitledDocument(
    await readUtf8(beliefsPath),
    '信念',
    options.batchId,
    renderBeliefsInner(committed),
  )

  await lockedAtomicWrite(storyPath, story, hooksOf(options.hooks?.beforeStory))
  await lockedAtomicWrite(beliefsPath, beliefs, hooksOf(options.hooks?.beforeBeliefs))

  const summary = draft.reflect?.lifeStorySummary
    ?? (await options.store.readProfile())?.lifeStorySummary
    ?? ''
  if (summary.trim().length > 0) {
    await writeMemoryTheme(memPath, options.batchId, summary, hooksOf(options.hooks?.beforeMemory))
  }

  const profile: GrowthProfile = {
    ...draft.profile,
    status: 'committed',
    ...(summary.trim().length > 0 ? { lifeStorySummary: summary } : {}),
  }
  await options.store.writeProfile(profile)
  await options.store.writeBeats(
    options.batchId,
    draft.beats.map((beat) => (
      committed.some((item) => item.id === beat.id)
        ? { ...beat, status: 'committed' }
        : { ...beat, status: 'excluded' }
    )),
  )

  return {
    batchId: options.batchId,
    storyPath,
    beliefsPath,
    memoryPath: memPath,
    story,
    beliefs,
    committed,
  }
}

function hooksOf(beforeRename?: AtomicWriteHooks['beforeRename']): AtomicWriteHooks {
  return beforeRename === undefined ? {} : { beforeRename }
}

async function readUtf8(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT') {
      return ''
    }
    throw error
  }
}
