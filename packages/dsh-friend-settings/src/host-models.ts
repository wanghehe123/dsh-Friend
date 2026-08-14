import {
  MODEL_OVERRIDE_FIELDS,
  buildFriendGenerateOptions,
  completeViaLlmStream,
  requireLlmRoute,
  resolveModel,
  type FriendDefaultModelSelection,
  type FriendLlmRuntime,
  type FriendModelCatalog,
  type FriendModelPurpose,
  type FriendResolvedModel,
  type ResolveModelDeps,
} from '@wishp3/dsh-friend-shared'

import type { ModelInheritView } from './model-form.ts'
import type { SettingsReader } from './project.ts'
import { projectModelOverride } from './sanitize.ts'

export type HostModelViewsDeps = {
  getDefaultModel: () => FriendDefaultModelSelection | Promise<FriendDefaultModelSelection>
  getSettings: SettingsReader['get']
  catalog?: FriendModelCatalog
  warn?: (message: string) => void
}

export async function buildModelInheritViews(deps: HostModelViewsDeps): Promise<ModelInheritView[]> {
  const fallback = await deps.getDefaultModel()
  const purposes: FriendModelPurpose[] = ['chat', 'summarize', 'growth']
  const views: ModelInheritView[] = []
  for (const purpose of purposes) {
    const field = MODEL_OVERRIDE_FIELDS[purpose]
    let section: unknown
    try {
      section = deps.getSettings(field.namespace)
    } catch {
      section = undefined
    }
    const override = readField(section, field.key)
    const resolveDeps: ResolveModelDeps = {
      getDefaultModel: deps.getDefaultModel,
      getSettings: deps.getSettings,
      ...(deps.catalog !== undefined ? { catalog: deps.catalog } : {}),
      ...(deps.warn !== undefined ? { warn: deps.warn } : {}),
    }
    const resolved = await resolveModel(purpose, resolveDeps)
    views.push({
      purpose,
      inherited: { provider: fallback.provider, model: fallback.model },
      override: projectModelOverride(override),
      resolved: toViewResolved(resolved),
    })
  }
  return views
}

export type PingFriendModelInput = {
  purpose: FriendModelPurpose
  override: string
  models: HostModelViewsDeps
  llm?: FriendLlmRuntime
}

/**
 * Probe the model the overlay would actually use. A draft override is applied
 * only for this call — it is not written to settings. openai-compat routes
 * have no `ctx.llm` adapter, so they fail closed instead of faking success.
 */
export async function pingFriendModel(input: PingFriendModelInput): Promise<{ ok: boolean; detail: string }> {
  const field = MODEL_OVERRIDE_FIELDS[input.purpose]
  const override = input.override.trim()
  const resolveDeps: ResolveModelDeps = {
    getDefaultModel: input.models.getDefaultModel,
    getSettings: (namespace) => {
      const live = input.models.getSettings(namespace)
      if (namespace !== field.namespace || override.length === 0) {
        return live
      }
      return overlayField(live, field.key, override)
    },
    ...(input.models.catalog !== undefined ? { catalog: input.models.catalog } : {}),
    ...(input.models.warn !== undefined ? { warn: input.models.warn } : {}),
  }

  let resolved: FriendResolvedModel
  try {
    resolved = await resolveModel(input.purpose, resolveDeps)
  } catch (error) {
    return { ok: false, detail: errorMessage(error) }
  }

  if (resolved.kind === 'openai-compat') {
    return {
      ok: false,
      detail: `${resolved.baseURL} 不走 ctx.llm，无法在此页探测`,
    }
  }

  if (input.llm === undefined) {
    return { ok: false, detail: 'llm runtime unavailable' }
  }

  try {
    const text = await completeViaLlmStream(input.llm, buildFriendGenerateOptions({
      route: requireLlmRoute(resolved, '@wishp3/dsh-friend-settings'),
      system: 'Reply with the single word pong and nothing else.',
      user: 'ping',
      maxTokens: 64,
    }))
    const reply = text.trim().slice(0, 80)
    const route = `${resolved.provider}/${resolved.model}`
    return {
      ok: true,
      detail: reply.length > 0 ? `${route} · ${reply}` : `${route} · 已连通`,
    }
  } catch (error) {
    return { ok: false, detail: errorMessage(error) }
  }
}

export function toViewResolved(model: FriendResolvedModel): ModelInheritView['resolved'] {
  if (model.kind === 'openai-compat') {
    return {
      kind: model.kind,
      model: model.model,
      baseURL: model.baseURL,
    }
  }
  return {
    kind: model.kind,
    provider: model.provider,
    model: model.model,
  }
}

function readField(section: unknown, key: string): unknown {
  if (section === undefined || section === null || typeof section !== 'object' || Array.isArray(section)) {
    return undefined
  }
  return (section as Record<string, unknown>)[key]
}

function overlayField(section: unknown, key: string, value: string): Record<string, unknown> {
  const base = section !== undefined && section !== null && typeof section === 'object' && !Array.isArray(section)
    ? { ...(section as Record<string, unknown>) }
    : {}
  base[key] = value
  return base
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : String(error)
}
