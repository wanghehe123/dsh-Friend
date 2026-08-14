import type { FriendPromptSection } from '@wishp3/dsh-friend-shared'

export class MockPromptPipeline {
  readonly global: FriendPromptSection[] = []
  readonly scopes = new Map<string, FriendPromptSection[]>()

  context(scope?: string): {
    systemPrompt: { section: (section: FriendPromptSection) => () => void }
  } {
    const bucket = scope === undefined ? this.global : this.scopeBucket(scope)
    return {
      systemPrompt: {
        section: (section) => {
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
