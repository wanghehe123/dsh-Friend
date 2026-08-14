import type { FriendPromptSection } from '@wishp3/dsh-friend-shared'

/**
 * Mock of the official assemble pipeline (`agent → preset → global`).
 *
 * Sections registered on a named scope are invisible to every other scope.
 * A coding-preset assemble therefore only sees the global layer — the W-M1-3
 * scope-mask acceptance: non-companion assemblies contain no friend sections.
 */
export class MockPromptPipeline {
  readonly global: FriendPromptSection[] = []
  readonly scopes = new Map<string, FriendPromptSection[]>()

  context(scope?: string): {
    systemPrompt: { section: (section: FriendPromptSection) => () => void }
  } {
    const bucket = scope === undefined ? this.global : this.scopeBucket(scope)
    return {
      systemPrompt: {
        section: (section: FriendPromptSection) => {
          bucket.push(section)
          return () => {
            const index = bucket.indexOf(section)
            if (index >= 0) {
              bucket.splice(index, 1)
            }
          }
        },
      },
    }
  }

  assemble(scope?: string): { names: string[]; text: string } {
    const sections = [...this.global]
    if (scope !== undefined) {
      sections.push(...(this.scopes.get(scope) ?? []))
    }
    sections.sort((left, right) => left.order - right.order)
    const resolved = sections.map((section) => ({
      name: section.name,
      text: typeof section.text === 'function' ? section.text({}) : section.text,
    }))
    return {
      names: resolved.map((section) => section.name),
      text: resolved.map((section) => section.text).join('\n\n'),
    }
  }

  private scopeBucket(scope: string): FriendPromptSection[] {
    const existing = this.scopes.get(scope)
    if (existing !== undefined) {
      return existing
    }
    const created: FriendPromptSection[] = []
    this.scopes.set(scope, created)
    return created
  }
}

export const FRIEND_SECTION_MARKERS = [
  'friend:persona',
  'friend:conduct',
  '表情标签协议',
  '记忆记录守则',
  '语言约束',
  'memory_append',
] as const
