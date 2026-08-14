import {
  resolveModel,
  type FriendResolvedModel,
  type ResolveModelDeps,
} from '@wish233/dsh-friend-shared'

/**
 * Test / host seam for one completion. Production default is
 * `ctx.llm.stream()` via `createLiveMemoryComplete`. Unit tests inject a
 * mock and never call a model.
 */
export type CompletePrompt = (input: {
  system: string
  user: string
  model: FriendResolvedModel
}) => Promise<string>

export type MemoryLlm = {
  complete: CompletePrompt
  resolve: (purpose: 'summarize') => Promise<FriendResolvedModel>
}

export function createMemoryLlm(options: {
  resolveDeps: ResolveModelDeps
  complete: CompletePrompt
}): MemoryLlm {
  return {
    complete: options.complete,
    resolve: (purpose) => resolveModel(purpose, options.resolveDeps),
  }
}

export async function runPrompt(
  llm: MemoryLlm,
  input: { system: string; user: string },
): Promise<string> {
  const model = await llm.resolve('summarize')
  return llm.complete({ ...input, model })
}
