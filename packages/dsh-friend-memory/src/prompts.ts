/**
 * Prompt text rewritten from Kokoro `memory_extractor.rs` (English source)
 * into Chinese, plus the nightly distill contract from the memory spec.
 */

export const EXTRACTION_SYSTEM_PROMPT = [
  '你是记忆抽取助手。阅读下面的对话，抽出值得在以后对话里记住的事实。',
  '',
  '只抽取这类内容：',
  '- 用户的名字、偏好、爱好、忌口或个人细节',
  '- 重要事件、日期或计划',
  '- 用户对具体事物的看法或感受',
  '- 承诺或约定',
  '',
  '规则：',
  '- 压成 1 到 3 条短事实，每条一句话',
  '- 已经出现在「已有记忆」里的内容不要重复',
  '- 没有值得记的事就输出空数组',
  '',
  '只输出 JSON 数组，不要解释，不要 markdown 围栏：',
  '[{"fact":"..."}]',
].join('\n')

export function buildExtractionUserPrompt(input: {
  transcript: string
  existing: readonly string[]
}): string {
  const existingBlock = input.existing.length === 0
    ? '（无）'
    : input.existing.map((line) => `- ${line}`).join('\n')
  return [
    '已有记忆（不要重复）：',
    existingBlock,
    '',
    '对话：',
    input.transcript,
  ].join('\n')
}

export function buildDistillSystemPrompt(maxBytes: number): string {
  return [
    '你是长期记忆蒸馏助手。把近几天的每日笔记整理进 MEMORY.md 的固定四分节。',
    '',
    '四分节标题必须原样输出，且只输出这四节：',
    '## 关于用户',
    '## 重要事实',
    '## 近期主题',
    '## 待办与约定',
    '',
    '规则：',
    '- 新事实优先写入；措辞可以改写，但不能让已有事实消失',
    '- 标注「重要」的事实必须保留（允许改写措辞，不允许删除）',
    '- 互相矛盾的说法两边都留，并各自标上日期',
    `- 全文体积必须回到 ${maxBytes} 字节以内`,
    '- 原始每日笔记不会被你改写，你只输出新的 MEMORY.md',
    '- 不要输出四分节以外的标题或前言',
  ].join('\n')
}

export function buildDistillUserPrompt(input: {
  memory: string
  notes: ReadonlyArray<{ date: string; text: string }>
}): string {
  const notesBlock = input.notes.length === 0
    ? '（近 7 天无笔记）'
    : input.notes.map((note) => `### ${note.date}\n${note.text}`).join('\n\n')
  return [
    '当前 MEMORY.md：',
    input.memory.trim().length > 0 ? input.memory : '（空）',
    '',
    '近 7 天每日笔记：',
    notesBlock,
  ].join('\n')
}

export function parseExtractedFacts(raw: string): string[] {
  const trimmed = stripFence(raw).trim()
  if (trimmed.length === 0 || trimmed === '[]') {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) {
      return []
    }
    const facts: string[] = []
    for (const item of parsed) {
      if (typeof item === 'string' && item.trim().length > 0) {
        facts.push(item.trim())
        continue
      }
      if (item !== null && typeof item === 'object' && 'fact' in item) {
        const fact = (item as { fact: unknown }).fact
        if (typeof fact === 'string' && fact.trim().length > 0) {
          facts.push(fact.trim())
        }
      }
    }
    return facts.slice(0, 3)
  } catch {
    return []
  }
}

export function stripFence(raw: string): string {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(raw.trim())
  return match?.[1] ?? raw
}

export function isExtractedOutputOversized(raw: string, maxChars = 4000): boolean {
  return raw.length > maxChars
}
