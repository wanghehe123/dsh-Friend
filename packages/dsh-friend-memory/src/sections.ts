import { registerPromptSection, type FriendPromptContext } from '@wish233/dsh-friend-shared'

import type { BootstrapBundle } from './retriever.ts'

export const MEMORY_SECTION_NAME = 'friend:memory'
export const MEMORY_SECTION_ORDER = 30

export type MemorySectionSource = {
  load: () => BootstrapBundle
  budgetBytes?: number
}

export function formatMemorySection(bundle: BootstrapBundle, budgetBytes = 12 * 1024): string {
  return renderMemoryParts(applyBootstrapBudget(bundle, budgetBytes))
}

/**
 * MEMORY.md is kept first. Notes are truncated newest-first (today, then
 * yesterday) until the rendered section fits `budgetBytes`.
 */
export function applyBootstrapBudget(bundle: BootstrapBundle, budgetBytes: number): BootstrapBundle {
  const tryRender = (next: BootstrapBundle): number =>
    Buffer.byteLength(formatMemorySectionUnbudgeted(next), 'utf8')

  if (tryRender(bundle) <= budgetBytes) {
    return bundle
  }

  const clipped: BootstrapBundle = { ...bundle }
  if (tryRender({ ...clipped, yesterday: '' }) <= budgetBytes) {
    clipped.yesterday = truncateToBudget(
      clipped.yesterday,
      budgetBytes - tryRender({ ...clipped, yesterday: '' }),
    )
    return clipped
  }
  clipped.yesterday = ''
  if (tryRender(clipped) <= budgetBytes) {
    return clipped
  }
  if (tryRender({ ...clipped, today: '' }) <= budgetBytes) {
    clipped.today = truncateToBudget(
      clipped.today,
      budgetBytes - tryRender({ ...clipped, today: '' }),
    )
    return clipped
  }
  clipped.today = ''
  if (tryRender(clipped) <= budgetBytes) {
    return clipped
  }
  clipped.user = ''
  if (tryRender(clipped) <= budgetBytes) {
    return clipped
  }
  const headerBytes = tryRender({ memory: '', today: '', yesterday: '', user: '' })
  clipped.memory = truncateToBudget(clipped.memory, Math.max(0, budgetBytes - headerBytes))
  return clipped
}

export function renderMemorySectionText(source: MemorySectionSource): string {
  return formatMemorySection(source.load(), source.budgetBytes)
}

/**
 * Register the memory prompt section on the **calling** context.
 * Must run on the companion preset standing mount.
 */
export function registerMemorySection(
  ctx: FriendPromptContext,
  source: MemorySectionSource,
): () => void {
  return registerPromptSection(ctx, {
    name: MEMORY_SECTION_NAME,
    order: MEMORY_SECTION_ORDER,
    text: () => renderMemorySectionText(source),
  })
}

function renderMemoryParts(bundle: BootstrapBundle): string {
  const parts = [
    '# 记忆',
    '',
    '## MEMORY.md',
    '',
    emptyAsNote(bundle.memory, '（尚无长期记忆）'),
    '',
    '## USER.md',
    '',
    emptyAsNote(bundle.user, '（尚无用户画像）'),
    '',
    '## 今日笔记',
    '',
    emptyAsNote(bundle.today, '（今日尚无笔记）'),
    '',
    '## 昨日笔记',
    '',
    emptyAsNote(bundle.yesterday, '（昨日尚无笔记）'),
    '',
  ]
  return `${parts.join('\n')}\n`
}

function formatMemorySectionUnbudgeted(bundle: BootstrapBundle): string {
  return renderMemoryParts(bundle)
}

function emptyAsNote(text: string, placeholder: string): string {
  return text.trim().length > 0 ? text.trimEnd() : placeholder
}

function truncateToBudget(text: string, budget: number): string {
  if (budget <= 0 || text.length === 0) {
    return ''
  }
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.length <= budget) {
    return text
  }
  const sliced = buffer.subarray(0, Math.max(0, budget - 15)).toString('utf8')
  return `${sliced.replace(/\uFFFD$/u, '')}\n…(截断)`
}
