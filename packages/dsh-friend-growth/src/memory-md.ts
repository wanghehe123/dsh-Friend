import { readFile } from 'node:fs/promises'

import { lockedAtomicWrite, type AtomicWriteHooks } from './atomic.ts'

export const MEMORY_SECTION_TITLES = ['关于用户', '重要事实', '近期主题', '待办与约定'] as const
export type MemorySectionTitle = (typeof MEMORY_SECTION_TITLES)[number]
export const THEME_SECTION: MemorySectionTitle = '近期主题'

export type ParsedMemory = {
  preamble: string
  sections: Record<MemorySectionTitle, string>
  extras: ReadonlyArray<{ title: string; body: string }>
}

export function emptyMemory(): ParsedMemory {
  return {
    preamble: '',
    sections: {
      关于用户: '',
      重要事实: '',
      近期主题: '',
      待办与约定: '',
    },
    extras: [],
  }
}

export function parseMemoryMarkdown(raw: string): ParsedMemory {
  const parsed = emptyMemory()
  if (raw.trim().length === 0) {
    return parsed
  }
  const extras: Array<{ title: string; body: string }> = []
  let preamble = ''
  for (const block of splitMarkdownSections(raw)) {
    if (block.title === undefined) {
      preamble = block.body
      continue
    }
    if (isMemorySectionTitle(block.title)) {
      parsed.sections[block.title] = block.body
      continue
    }
    extras.push({ title: block.title, body: block.body })
  }
  parsed.preamble = preamble
  parsed.extras = extras
  return parsed
}

export function serializeMemoryMarkdown(parsed: ParsedMemory): string {
  const lines: string[] = []
  if (parsed.preamble.trim().length > 0) {
    lines.push(parsed.preamble.trimEnd(), '')
  }
  for (const title of MEMORY_SECTION_TITLES) {
    lines.push(`## ${title}`, '')
    const body = parsed.sections[title].trim()
    if (body.length > 0) {
      lines.push(body, '')
    }
  }
  for (const extra of parsed.extras) {
    lines.push(`## ${extra.title}`, '')
    const body = extra.body.trim()
    if (body.length > 0) {
      lines.push(body, '')
    }
  }
  return `${lines.join('\n').replace(/\s+$/u, '')}\n`
}

export function growthBatchMarker(batchId: string): { open: string; close: string } {
  return {
    open: `<!-- growth-batch:${batchId} -->`,
    close: `<!-- /growth-batch:${batchId} -->`,
  }
}

/**
 * Replace or append this batch's life-story summary in 「近期主题」.
 * Other sections, preamble, and extras stay byte-stable aside from
 * trailing whitespace normalization of the whole file.
 */
export function upsertThemeSummary(
  parsed: ParsedMemory,
  batchId: string,
  summary: string,
): ParsedMemory {
  const { open, close } = growthBatchMarker(batchId)
  const block = `${open}\n${summary.trim()}\n${close}`
  const current = parsed.sections[THEME_SECTION]
  const replaced = replaceBatchBlock(current, batchId, block)
  return {
    ...parsed,
    sections: {
      ...parsed.sections,
      [THEME_SECTION]: replaced,
    },
  }
}

export function replaceBatchBlock(body: string, batchId: string, nextBlock: string): string {
  const { open, close } = growthBatchMarker(batchId)
  const start = body.indexOf(open)
  if (start < 0) {
    const trimmed = body.trim()
    return trimmed.length === 0 ? nextBlock : `${trimmed}\n\n${nextBlock}`
  }
  const end = body.indexOf(close, start)
  if (end < 0) {
    return `${body.slice(0, start).trimEnd()}\n\n${nextBlock}`.trim()
  }
  const before = body.slice(0, start).trimEnd()
  const after = body.slice(end + close.length).trimStart()
  return [before, nextBlock, after].filter((part) => part.length > 0).join('\n\n')
}

export async function readMemoryFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT') {
      return ''
    }
    throw error
  }
}

export async function writeMemoryTheme(
  path: string,
  batchId: string,
  summary: string,
  hooks: AtomicWriteHooks = {},
): Promise<string> {
  const raw = await readMemoryFile(path)
  const next = serializeMemoryMarkdown(upsertThemeSummary(parseMemoryMarkdown(raw), batchId, summary))
  await lockedAtomicWrite(path, next, hooks)
  return next
}

function isMemorySectionTitle(title: string): title is MemorySectionTitle {
  return (MEMORY_SECTION_TITLES as readonly string[]).includes(title)
}

function splitMarkdownSections(raw: string): Array<{ title?: string; body: string }> {
  const lines = raw.split(/\r?\n/u)
  const blocks: Array<{ title?: string; body: string[] }> = [{ body: [] }]
  for (const line of lines) {
    const heading = /^##[ \t]+(.+?)\s*$/u.exec(line)
    if (heading !== null && heading[1] !== undefined) {
      blocks.push({ title: heading[1], body: [] })
      continue
    }
    blocks[blocks.length - 1]?.body.push(line)
  }
  return blocks.map((block) => ({
    ...(block.title !== undefined ? { title: block.title } : {}),
    body: trimSectionBody(block.body.join('\n')),
  }))
}

function trimSectionBody(body: string): string {
  return body.replace(/^\n+/u, '').replace(/\s+$/u, '')
}
