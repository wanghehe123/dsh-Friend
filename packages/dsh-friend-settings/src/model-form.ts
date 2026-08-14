/**
 * Model section form (W-M8-3). Three purpose overrides + inherit display.
 * Connection test is injected so unit tests never open a network socket.
 *
 * Types are local so the client half never imports `@wish233/dsh-friend-shared`
 * (host / Node builtins). Host `resolveModel` uses the same purpose names.
 */
export type FriendModelPurpose = 'chat' | 'summarize' | 'growth'

export type ModelOverrideDraft = {
  chat: string
  summarize: string
  growth: string
}

export type ModelInheritView = {
  purpose: FriendModelPurpose
  inherited: { provider: string; model: string }
  override: unknown
  resolved: { kind: string; provider?: string; model: string; baseURL?: string }
}

export type ModelTestResult = {
  purpose: FriendModelPurpose
  ok: boolean
  detail: string
}

export type ModelSectionForm = {
  getDraft(): ModelOverrideDraft
  getCommitted(): ModelOverrideDraft
  isDirty(): boolean
  set<K extends keyof ModelOverrideDraft>(field: K, value: ModelOverrideDraft[K]): void
  inheritViews(): readonly ModelInheritView[]
  test(purpose: FriendModelPurpose): Promise<ModelTestResult>
  commit(): Promise<void>
  discard(): void
}

export type ModelFieldWriter = {
  setChat(value: string): Promise<void>
  setSummarize(value: string): Promise<void>
  setGrowth(value: string): Promise<void>
}

export type CreateModelSectionFormOptions = {
  chat?: unknown
  summarize?: unknown
  growth?: unknown
  inheritViews?: readonly ModelInheritView[]
  writer?: ModelFieldWriter
  testConnection?: (purpose: FriendModelPurpose, override: string) => Promise<ModelTestResult>
}

export function overrideToInput(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (typeof record.model === 'string' && typeof record.provider === 'string') {
      return `${record.provider}:${record.model}`
    }
    if (typeof record.model === 'string') {
      return record.model
    }
  }
  return ''
}

export function createModelSectionForm(options: CreateModelSectionFormOptions = {}): ModelSectionForm {
  const readCommitted = (): ModelOverrideDraft => ({
    chat: overrideToInput(options.chat),
    summarize: overrideToInput(options.summarize),
    growth: overrideToInput(options.growth),
  })
  let committed = readCommitted()
  let draft = { ...committed }
  const views = options.inheritViews ?? []

  return {
    getDraft() {
      return { ...draft }
    },
    getCommitted() {
      return { ...committed }
    },
    isDirty() {
      return draft.chat !== committed.chat
        || draft.summarize !== committed.summarize
        || draft.growth !== committed.growth
    },
    set(field, value) {
      draft = { ...draft, [field]: value }
    },
    inheritViews() {
      return views
    },
    async test(purpose) {
      const override = draft[purpose === 'chat' ? 'chat' : purpose === 'summarize' ? 'summarize' : 'growth']
      if (options.testConnection !== undefined) {
        return options.testConnection(purpose, override)
      }
      return {
        purpose,
        ok: override.length === 0 || override.trim().length > 0,
        detail: override.length === 0 ? 'inherit' : 'local',
      }
    },
    async commit() {
      const next = { ...draft }
      if (options.writer !== undefined) {
        await options.writer.setChat(next.chat)
        await options.writer.setSummarize(next.summarize)
        await options.writer.setGrowth(next.growth)
      }
      committed = next
      draft = { ...next }
    },
    discard() {
      committed = readCommitted()
      draft = { ...committed }
    },
  }
}
