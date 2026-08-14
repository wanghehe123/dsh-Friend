import {
  MODEL_OVERRIDE_FIELDS,
  resolveModel,
  type FriendDefaultModelSelection,
  type FriendModelCatalog,
  type FriendModelPurpose,
  type FriendResolvedModel,
  type ResolveModelDeps,
} from '@wish233/dsh-friend-shared'

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
