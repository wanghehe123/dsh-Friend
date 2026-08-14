import {
  defineTool,
  registerTool,
  type FriendToolContext,
  type ToolDefinition,
} from '@wish233/dsh-friend-shared'

import type { MemoryRetriever } from './retriever.ts'
import type { MemoryStore } from './store.ts'
import { MemoryPathError } from './whitelist.ts'

/** Must stay equal to `@wish233/dsh-friend-persona` `MEMORY_TOOLS`. */
export const MEMORY_TOOL_NAMES = ['memory_append', 'memory_search', 'memory_get'] as const
export type MemoryToolName = (typeof MEMORY_TOOL_NAMES)[number]

export const MEMORY_APPEND_TARGETS = ['daily', 'longterm'] as const
export type MemoryAppendTarget = (typeof MEMORY_APPEND_TARGETS)[number]

const APPEND_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    target: { type: 'string', required: true },
    path: { type: 'string', required: true },
  },
} as const

const SEARCH_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    hits: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          line: { type: 'integer', required: true },
          snippet: { type: 'string', required: true },
          score: { type: 'integer', required: true },
        },
      },
    },
  },
} as const

const GET_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    path: { type: 'string', required: true },
    text: { type: 'string', required: true },
    error: { type: 'string' },
  },
} as const

function renderOk(): [] {
  return []
}

export type MemoryToolDeps = {
  store: MemoryStore
  retriever: MemoryRetriever
}

export function createMemoryTools(deps: MemoryToolDeps): readonly ToolDefinition[] {
  const append = defineTool({
    name: 'memory_append',
    description:
      'Remember a fact. Use daily for today\'s notes and longterm for lasting facts about the user.',
    parameters: {
      text: {
        type: 'string',
        required: true,
        description: 'The fact to remember, in the user\'s language.',
      },
      target: {
        type: 'string',
        enum: MEMORY_APPEND_TARGETS,
        required: true,
        description: 'daily writes today\'s note; longterm writes the 重要事实 section of MEMORY.md.',
      },
    },
    output: {
      schema: APPEND_OUTPUT,
      render: renderOk,
    },
    async execute(args) {
      const text = args.text.trim()
      if (text.length === 0) {
        throw new Error('dsh-friend-memory: text is empty')
      }
      if (args.target === 'longterm') {
        await deps.store.appendLongterm(text)
        return { ok: true as const, target: 'longterm', path: 'MEMORY.md' }
      }
      const written = await deps.store.appendDaily({ text, source: 'note' })
      return { ok: true as const, target: 'daily', path: written.path }
    },
  })

  const search = defineTool({
    name: 'memory_search',
    description: 'Search MEMORY.md, daily notes, and story.md by literal keywords. No embeddings.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Literal keyword or phrase. Regular-expression metacharacters are matched as text.',
      },
    },
    output: {
      schema: SEARCH_OUTPUT,
      render: renderOk,
    },
    async execute(args) {
      const hits = await deps.retriever.search(args.query)
      return { ok: true as const, hits }
    },
  })

  const get = defineTool({
    name: 'memory_get',
    description: 'Read a memory file (or a line range) inside the friend data directory.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Path relative to the friend data root, e.g. characters/default/memory/2026-08-14.md',
      },
      from: {
        type: 'integer',
        description: '1-based start line (inclusive).',
      },
      to: {
        type: 'integer',
        description: '1-based end line (inclusive).',
      },
    },
    output: {
      schema: GET_OUTPUT,
      render: renderOk,
    },
    async execute(args) {
      try {
        const range = args.from === undefined && args.to === undefined
          ? undefined
          : {
              ...(args.from !== undefined ? { from: args.from } : {}),
              ...(args.to !== undefined ? { to: args.to } : {}),
            }
        const text = await deps.retriever.get(args.path, range)
        return { ok: true as const, path: args.path, text }
      } catch (error) {
        if (error instanceof MemoryPathError) {
          return { ok: false as const, path: args.path, text: '', error: error.message }
        }
        throw error
      }
    },
  })

  return [append, search, get]
}

/**
 * Register the three tools on the **calling** context.
 * Must run on the companion preset standing mount, not the host-global ctx.
 */
export function registerMemoryTools(ctx: FriendToolContext, deps: MemoryToolDeps): () => void {
  const disposers = createMemoryTools(deps).map((definition) => registerTool(ctx, definition))
  return () => {
    for (const dispose of disposers.slice().reverse()) {
      dispose()
    }
  }
}
