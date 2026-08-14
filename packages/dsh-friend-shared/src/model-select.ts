import type { FriendDefaultModelSelection, FriendModelCatalog } from './compat/llm.ts'
import {
  FRIEND_SETTINGS_NAMESPACES,
  type FriendSettingsNamespace,
} from './compat/namespaces.ts'

export type FriendModelPurpose = 'chat' | 'summarize' | 'growth'

/**
 * A model already routed through dsh (`ctx.llm` adapter + provider id).
 * `provider` is the registered route; `model` is the provider-owned id.
 */
export interface FriendRegisteredModel {
  kind: 'registered'
  provider: string
  model: string
  reasoningEffort?: string
}

/**
 * OpenAI-compatible endpoint override. Friend does not register a new dsh
 * adapter from this object — callers (summarize / growth jobs) own the
 * HTTP call. `apiKey` stays host-side and must never be pushed to the client.
 */
export interface FriendOpenAiCompatModel {
  kind: 'openai-compat'
  baseURL: string
  model: string
  apiKey?: string
  api?: string
}

export type FriendResolvedModel = FriendRegisteredModel | FriendOpenAiCompatModel

/**
 * Per-purpose override locations. Namespaces are kebab (`friend-persona`, …)
 * because `settingsNamespace()` rejects dotted names such as `friend.persona`.
 */
export const MODEL_OVERRIDE_FIELDS = {
  chat: {
    namespace: FRIEND_SETTINGS_NAMESPACES.persona,
    key: 'chatModel',
  },
  summarize: {
    namespace: FRIEND_SETTINGS_NAMESPACES.memory,
    key: 'summarizeModel',
  },
  growth: {
    namespace: FRIEND_SETTINGS_NAMESPACES.growth,
    key: 'model',
  },
} as const satisfies Record<
  FriendModelPurpose,
  { namespace: FriendSettingsNamespace; key: string }
>

export interface ResolveModelDeps {
  /**
   * Official: `ctx.agentDefaultModel.currentSelection()`
   * (`@deepseek-ai/dsh-agent-default-model`). Required — this is the
   * inherit path that makes zero-config chat work.
   */
  getDefaultModel: () => FriendDefaultModelSelection | Promise<FriendDefaultModelSelection>
  /**
   * Read one Friend settings document (the resolved section object).
   * Official: `ctx.settings.get(ns)` (`@deepseek-ai/dsh-settings`).
   * Unregistered namespaces return `undefined`.
   */
  getSettings: (namespace: FriendSettingsNamespace) => unknown
  /**
   * Optional advisory catalog from `ctx.llm`. When omitted, a string
   * override is accepted as `{ provider: default.provider, model: override }`.
   */
  catalog?: FriendModelCatalog
  /** Defaults to `console.warn`. Illegal overrides must not throw. */
  warn?: (message: string) => void
}

/**
 * Resolve the model for one Friend purpose.
 *
 * Fallback chain: legal override → dsh default. An illegal override SHALL
 * warn and return the default; this function does not throw.
 */
export async function resolveModel(
  purpose: FriendModelPurpose,
  deps: ResolveModelDeps,
): Promise<FriendResolvedModel> {
  const warn = deps.warn ?? defaultWarn
  const fallback = asRegistered(await deps.getDefaultModel())
  const field = MODEL_OVERRIDE_FIELDS[purpose]
  let section: unknown
  try {
    section = deps.getSettings(field.namespace)
  } catch (error) {
    warn(
      `dsh-friend: failed to read ${field.namespace}.${field.key} for ${purpose}; falling back to dsh default (${cause(error)})`,
    )
    return fallback
  }

  const raw = readField(section, field.key)
  if (raw === undefined) {
    return fallback
  }

  const catalogIndex = await indexCatalog(deps.catalog)
  const parsed = parseOverride(raw, fallback, catalogIndex)
  if (parsed.status === 'ok') {
    return parsed.model
  }

  warn(
    `dsh-friend: illegal ${purpose} model override (${parsed.reason}); falling back to dsh default`,
  )
  return fallback
}

function defaultWarn(message: string): void {
  console.warn(message)
}

function asRegistered(selection: FriendDefaultModelSelection): FriendRegisteredModel {
  return {
    kind: 'registered',
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort !== undefined
      ? { reasoningEffort: selection.reasoningEffort }
      : {}),
  }
}

function readField(section: unknown, key: string): unknown {
  if (section === undefined || section === null) {
    return undefined
  }
  if (typeof section !== 'object' || Array.isArray(section)) {
    return undefined
  }
  if (!Object.hasOwn(section, key)) {
    return undefined
  }
  return (section as Record<string, unknown>)[key]
}

type CatalogIndex = {
  providers: ReadonlySet<string>
  models: ReadonlyArray<{ provider: string; id: string }>
}

async function indexCatalog(catalog: FriendModelCatalog | undefined): Promise<CatalogIndex | undefined> {
  if (catalog === undefined) {
    return undefined
  }
  const providers = new Set(catalog.listProviders().map((entry) => entry.id))
  const models: Array<{ provider: string; id: string }> = []
  if (catalog.listModels !== undefined) {
    for (const provider of providers) {
      const listed = await catalog.listModels(provider)
      for (const entry of listed) {
        models.push({ provider, id: entry.id })
      }
    }
  }
  return { providers, models }
}

type ParseResult =
  | { status: 'ok'; model: FriendResolvedModel }
  | { status: 'invalid'; reason: string }

function parseOverride(
  raw: unknown,
  fallback: FriendRegisteredModel,
  catalog: CatalogIndex | undefined,
): ParseResult {
  if (typeof raw === 'string') {
    return parseStringOverride(raw, fallback, catalog)
  }
  if (isPlainObject(raw)) {
    return parseObjectOverride(raw, catalog)
  }
  return { status: 'invalid', reason: `unsupported type ${typeof raw}` }
}

function parseStringOverride(
  raw: string,
  fallback: FriendRegisteredModel,
  catalog: CatalogIndex | undefined,
): ParseResult {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { status: 'invalid', reason: 'empty string' }
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { status: 'invalid', reason: 'endpoint URLs must use the openai-compat object shape' }
  }

  const split = splitProviderModel(trimmed)
  if (split !== undefined) {
    return acceptRegistered(split.provider, split.model, undefined, catalog)
  }

  return acceptRegistered(fallback.provider, trimmed, undefined, catalog)
}

function parseObjectOverride(
  raw: Record<string, unknown>,
  catalog: CatalogIndex | undefined,
): ParseResult {
  const baseURL = readNonEmptyString(raw, 'baseURL') ?? readNonEmptyString(raw, 'baseUrl')
  if (baseURL !== undefined) {
    return parseOpenAiCompat(raw, baseURL)
  }

  const provider = readNonEmptyString(raw, 'provider')
  const model = readNonEmptyString(raw, 'model')
  if (provider !== undefined && model !== undefined) {
    const effort = readNonEmptyString(raw, 'reasoningEffort')
    return acceptRegistered(provider, model, effort, catalog)
  }

  return { status: 'invalid', reason: 'object is neither {provider,model} nor {baseURL,model}' }
}

function parseOpenAiCompat(
  raw: Record<string, unknown>,
  baseURL: string,
): ParseResult {
  if (!isHttpUrl(baseURL)) {
    return { status: 'invalid', reason: 'baseURL must be an http(s) URL' }
  }
  const model = readNonEmptyString(raw, 'model')
  if (model === undefined) {
    return { status: 'invalid', reason: 'openai-compat override missing model' }
  }
  const apiKey = readNonEmptyString(raw, 'apiKey')
  const api = readNonEmptyString(raw, 'api')
  return {
    status: 'ok',
    model: {
      kind: 'openai-compat',
      baseURL,
      model,
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(api !== undefined ? { api } : {}),
    },
  }
}

function acceptRegistered(
  provider: string,
  model: string,
  reasoningEffort: string | undefined,
  catalog: CatalogIndex | undefined,
): ParseResult {
  if (catalog !== undefined) {
    if (catalog.providers.size > 0 && !catalog.providers.has(provider)) {
      return { status: 'invalid', reason: `provider "${provider}" is not registered` }
    }
    if (catalog.models.length > 0) {
      const exact = catalog.models.find((entry) => entry.provider === provider && entry.id === model)
      if (exact === undefined) {
        const elsewhere = catalog.models.find((entry) => entry.id === model)
        if (elsewhere !== undefined) {
          return {
            status: 'ok',
            model: registered(elsewhere.provider, elsewhere.id, reasoningEffort),
          }
        }
        return {
          status: 'invalid',
          reason: `model "${model}" is not in the registered catalog`,
        }
      }
    }
  }

  return {
    status: 'ok',
    model: registered(provider, model, reasoningEffort),
  }
}

function registered(
  provider: string,
  model: string,
  reasoningEffort: string | undefined,
): FriendRegisteredModel {
  return {
    kind: 'registered',
    provider,
    model,
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
  }
}

function splitProviderModel(raw: string): { provider: string; model: string } | undefined {
  for (const separator of [':', '/'] as const) {
    const index = raw.indexOf(separator)
    if (index <= 0 || index === raw.length - 1) {
      continue
    }
    const provider = raw.slice(0, index).trim()
    const model = raw.slice(index + 1).trim()
    if (provider.length > 0 && model.length > 0) {
      return { provider, model }
    }
  }
  return undefined
}

function readNonEmptyString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function cause(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
