import type { ServerResponse } from 'node:http'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { registerRoute, type FriendRouteContext } from '@wishp3/dsh-friend-shared'

import { commitGrowthDraft } from './commit.ts'
import { cause, isGet, readJsonBody, writeHtml, writeJson, writeText } from './http.ts'
import type { GrowthLlm } from './llm.ts'
import { newBatchId, runGrowthGeneration } from './pipeline.ts'
import {
  createGrowthProgressSnapshot,
  IDLE_GROWTH_PROGRESS,
  type GrowthProgressSnapshot,
  type GrowthProgressTracker,
} from './progress.ts'
import type { GrowthNode, GrowthProfile, ParsedBeat } from './pure.ts'
import type { GrowthSettings } from './settings.ts'
import type { GrowthStore } from './store.ts'
import { beatPreviewRows } from './ui-state.ts'
import { renderGrowthPage } from './ui-page.ts'

export type GrowthRouteDeps = {
  store: GrowthStore
  llm: GrowthLlm
  settings: () => GrowthSettings
  progress: GrowthProgressTracker
  now?: () => number
}

export function createGrowthRoutes(deps: GrowthRouteDeps): readonly WebRoute[] {
  const subscribers = new Set<ServerResponse>()

  const broadcast = (snapshot: GrowthProgressSnapshot): void => {
    const frame = `event: asset-progress\ndata: ${JSON.stringify({ type: 'asset-progress', payload: snapshot })}\n\n`
    for (const response of [...subscribers]) {
      try {
        if (response.writableEnded) {
          subscribers.delete(response)
          continue
        }
        response.write(frame)
      } catch {
        subscribers.delete(response)
      }
    }
  }
  deps.progress.subscribe(broadcast)

  return [
    {
      kind: 'exact',
      path: '/friend/growth',
      async handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        writeHtml(response, renderGrowthPage())
      },
    },
    {
      kind: 'exact',
      path: '/friend/growth/progress',
      async handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        writeJson(response, deps.progress.snapshot())
      },
    },
    {
      kind: 'exact',
      path: '/friend/growth/draft',
      async handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        writeJson(response, await draftPayload(deps))
      },
    },
    {
      kind: 'exact',
      path: '/friend/growth/events',
      handler(request, response) {
        if (!isGet(request)) {
          return writeText(response, 'Method Not Allowed', 405)
        }
        response.statusCode = 200
        response.setHeader('Content-Type', 'text/event-stream')
        response.setHeader('Cache-Control', 'no-cache')
        response.setHeader('Connection', 'keep-alive')
        response.flushHeaders?.()
        const snapshot = deps.progress.snapshot()
        response.write(`event: asset-progress\ndata: ${JSON.stringify({ type: 'asset-progress', payload: snapshot })}\n\n`)
        subscribers.add(response)
        const onClose = (): void => {
          subscribers.delete(response)
        }
        request.on('close', onClose)
        response.on('close', onClose)
      },
    },
    {
      kind: 'exact',
      path: '/friend/growth/preferences',
      async handler(request, response) {
        if (request.method !== 'POST') {
          return writeText(response, 'Method Not Allowed', 405)
        }
        try {
          const body = await readJsonBody(request) as { language?: unknown; model?: unknown }
          const current = await deps.store.readPreferences()
          const next = { ...current }
          if (typeof body.language === 'string' && body.language.trim().length > 0) {
            next.language = body.language.trim()
          }
          if (body.model !== undefined) {
            next.model = body.model
          }
          await deps.store.writePreferences(next)
          writeJson(response, { ok: true, preferences: next })
        } catch (error) {
          writeJson(response, { ok: false, error: cause(error) }, 400)
        }
      },
    },
    {
      kind: 'exact',
      path: '/friend/growth/generate',
      async handler(request, response) {
        if (request.method !== 'POST') {
          return writeText(response, 'Method Not Allowed', 405)
        }
        try {
          const result = await handleGenerate(deps, await readJsonBody(request))
          writeJson(response, result)
        } catch (error) {
          writeJson(response, { ok: false, error: cause(error) }, 409)
        }
      },
    },
    {
      kind: 'exact',
      path: '/friend/growth/exclude',
      async handler(request, response) {
        if (request.method !== 'POST') {
          return writeText(response, 'Method Not Allowed', 405)
        }
        try {
          const body = await readJsonBody(request) as { ids?: unknown; batchId?: unknown }
          const current = await deps.store.readCurrent()
          const batchId = typeof body.batchId === 'string' ? body.batchId : current?.batchId
          if (batchId === undefined) {
            return writeJson(response, { ok: false, error: 'no current batch' }, 400)
          }
          const ids = Array.isArray(body.ids)
            ? body.ids.filter((id): id is string => typeof id === 'string')
            : []
          await deps.store.writeExcluded(batchId, ids)
          writeJson(response, { ok: true, excluded: ids })
        } catch (error) {
          writeJson(response, { ok: false, error: cause(error) }, 400)
        }
      },
    },
    {
      kind: 'exact',
      path: '/friend/growth/commit',
      async handler(request, response) {
        if (request.method !== 'POST') {
          return writeText(response, 'Method Not Allowed', 405)
        }
        try {
          const body = await readJsonBody(request) as { batchId?: unknown; excludedIds?: unknown }
          const current = await deps.store.readCurrent()
          const batchId = typeof body.batchId === 'string' ? body.batchId : current?.batchId
          if (batchId === undefined) {
            return writeJson(response, { ok: false, error: 'no current batch' }, 400)
          }
          const excludedIds = Array.isArray(body.excludedIds)
            ? body.excludedIds.filter((id): id is string => typeof id === 'string')
            : undefined
          const result = await commitGrowthDraft({
            store: deps.store,
            batchId,
            ...(excludedIds !== undefined ? { excludedIds } : {}),
          })
          writeJson(response, {
            ok: true,
            batchId: result.batchId,
            committed: result.committed.map((beat) => beat.id),
          })
        } catch (error) {
          writeJson(response, { ok: false, error: cause(error) }, 409)
        }
      },
    },
  ]
}

export function registerGrowthRoutes(ctx: FriendRouteContext, deps: GrowthRouteDeps): void {
  for (const route of createGrowthRoutes(deps)) {
    registerRoute(ctx, route)
  }
}

export async function handleGenerate(deps: GrowthRouteDeps, raw: unknown): Promise<{
  ok: true
  batchId: string
  resumed: boolean
  beatCount: number
}> {
  const settings = deps.settings()
  if (!settings.enabled) {
    throw new Error('dsh-friend-growth: growth is disabled')
  }
  const body = isPlainObject(raw) ? raw : {}
  const continueLife = body.continue === true
  if (typeof body.language === 'string' || body.model !== undefined) {
    const prefs = await deps.store.readPreferences()
    await deps.store.writePreferences({
      ...prefs,
      ...(typeof body.language === 'string' ? { language: body.language } : {}),
      ...(body.model !== undefined ? { model: body.model } : {}),
    })
  }

  const existing = await deps.store.readCurrent()
  const existingDraft = existing === undefined ? undefined : await deps.store.readDraft(existing.batchId)
  const incomplete = existingDraft !== undefined
    && existingDraft.watermark.stage !== 'complete'
    && existingDraft.watermark.stage !== 'failed'

  let batchId: string
  let priorEpisodes: ParsedBeat[] = []
  if (incomplete && existing !== undefined) {
    batchId = existing.batchId
  } else {
    batchId = newBatchId(deps.now?.() ?? Date.now())
    if (continueLife && existingDraft !== undefined) {
      priorEpisodes = existingDraft.beats
        .filter((beat) => beat.kind !== 'reflection')
        .map((beat) => {
          const parsed: ParsedBeat = {
            kind: beat.kind,
            title: beat.title,
            narrative: beat.narrative,
            traitEffect: beat.traitEffect,
            importance: beat.importance,
          }
          if (beat.age !== undefined) {
            parsed.age = beat.age
          }
          if (beat.nodeId !== undefined) {
            parsed.nodeId = beat.nodeId
          }
          return parsed
        })
    }
  }

  const prefs = await deps.store.readPreferences()
  const language = typeof body.language === 'string' && body.language.trim().length > 0
    ? body.language.trim()
    : prefs.language ?? settings.language
  const profile = buildProfile({
    slug: deps.store.slug,
    language,
    body,
    ...(existingDraft !== undefined ? { previous: existingDraft.profile } : {}),
  })
  const nodes = readNodes(body.nodes)

  deps.progress.set(createGrowthProgressSnapshot({
    phase: 'outline',
    current: 0,
    total: 1,
    message: 'starting',
    batchId,
  }))

  const result = await runGrowthGeneration({
    store: deps.store,
    llm: deps.llm,
    batchId,
    profile,
    nodes,
    priorEpisodes,
    progress: deps.progress,
  })
  return {
    ok: true,
    batchId: result.batchId,
    resumed: result.resumed,
    beatCount: result.beats.length,
  }
}

async function draftPayload(deps: GrowthRouteDeps): Promise<object> {
  const current = await deps.store.readCurrent()
  const draft = current === undefined ? undefined : await deps.store.readDraft(current.batchId)
  const preferences = await deps.store.readPreferences()
  return {
    batchId: current?.batchId ?? '',
    profile: draft?.profile ?? null,
    beats: draft === undefined ? [] : beatPreviewRows(draft.beats, draft.excluded),
    excluded: draft?.excluded ?? [],
    progress: draft?.progress ?? deps.progress.snapshot() ?? IDLE_GROWTH_PROGRESS,
    preferences,
    watermark: draft?.watermark ?? null,
  }
}

function buildProfile(input: {
  slug: string
  language: string
  body: Record<string, unknown>
  previous?: GrowthProfile
}): GrowthProfile {
  const birthYear = readOptInt(input.body.birthYear) ?? input.previous?.birthYear
  const currentAge = readOptInt(input.body.currentAge) ?? input.previous?.currentAge
  const profile: GrowthProfile = {
    characterId: input.slug,
    baseAttributes: readOptString(input.body.baseAttributes) ?? input.previous?.baseAttributes ?? '{}',
    worldSetting: readOptString(input.body.worldSetting) ?? input.previous?.worldSetting ?? '',
    lifeStorySummary: input.previous?.lifeStorySummary ?? '',
    status: 'drafting',
    language: input.language,
  }
  if (birthYear !== undefined) {
    profile.birthYear = birthYear
  }
  if (currentAge !== undefined) {
    profile.currentAge = currentAge
  }
  return profile
}

function readNodes(raw: unknown): GrowthNode[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const nodes: GrowthNode[] = []
  for (const item of raw) {
    if (!isPlainObject(item) || typeof item.id !== 'number' || typeof item.title !== 'string') {
      continue
    }
    const node: GrowthNode = {
      id: item.id,
      stageLabel: typeof item.stageLabel === 'string' ? item.stageLabel : '',
      title: item.title,
      note: typeof item.note === 'string' ? item.note : '',
    }
    const ageFrom = readOptInt(item.ageFrom)
    const ageTo = readOptInt(item.ageTo)
    if (ageFrom !== undefined) {
      node.ageFrom = ageFrom
    }
    if (ageTo !== undefined) {
      node.ageTo = ageTo
    }
    nodes.push(node)
  }
  return nodes
}

function readOptInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined
}

function readOptString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
