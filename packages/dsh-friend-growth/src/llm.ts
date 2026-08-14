import {
  resolveModel,
  type FriendResolvedModel,
  type ResolveModelDeps,
} from '@wish233/dsh-friend-shared'

export type GrowthStage = 'outline' | 'expand' | 'reflect'

export type CompleteGrowthPrompt = (input: {
  stage: GrowthStage
  system: string
  user: string
  model: FriendResolvedModel
  temperature: number
}) => Promise<string>

export type GrowthLlm = {
  complete: CompleteGrowthPrompt
  resolve: () => Promise<FriendResolvedModel>
}

export function createGrowthLlm(options: {
  resolveDeps: ResolveModelDeps
  complete: CompleteGrowthPrompt
}): GrowthLlm {
  return {
    complete: options.complete,
    resolve: () => resolveModel('growth', options.resolveDeps),
  }
}

export async function runGrowthPrompt(
  llm: GrowthLlm,
  input: { stage: GrowthStage; system: string; user: string; temperature: number },
): Promise<string> {
  const model = await llm.resolve()
  return llm.complete({ ...input, model })
}
