import type { ToolDefinition, ToolRestriction } from '@wish233/dsh-friend-shared'

export class MockToolPipeline {
  readonly global: ToolDefinition[] = []
  readonly scopes = new Map<string, ToolDefinition[]>()

  context(scope?: string): {
    tools: {
      register: (definition: ToolDefinition) => () => void
      restrict: (filter: ToolRestriction) => () => void
    }
  } {
    const bucket = scope === undefined ? this.global : this.scopeBucket(scope)
    return {
      tools: {
        register: (definition) => {
          bucket.push(definition)
          return () => {
            const index = bucket.indexOf(definition)
            if (index >= 0) {
              bucket.splice(index, 1)
            }
          }
        },
        restrict: () => () => undefined,
      },
    }
  }

  visible(scope?: string): string[] {
    const names = this.global.map((tool) => tool.name)
    if (scope !== undefined) {
      names.push(...(this.scopes.get(scope) ?? []).map((tool) => tool.name))
    }
    return names
  }

  private scopeBucket(scope: string): ToolDefinition[] {
    const existing = this.scopes.get(scope)
    if (existing !== undefined) {
      return existing
    }
    const created: ToolDefinition[] = []
    this.scopes.set(scope, created)
    return created
  }
}
