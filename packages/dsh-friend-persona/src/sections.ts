import { readFileSync } from 'node:fs'

import {
  FRIEND_SETTINGS_NAMESPACES,
  registerPromptSection,
  type FriendPromptContext,
} from '@wishp3/dsh-friend-shared'

import { DEFAULT_PERSONA, DEFAULT_PERSONA_SLUG } from './default-persona.ts'
import { beliefsFilePath, personaFilePath } from './paths.ts'
import { validatePersona, type Persona } from './schema.ts'
import { assertSafeSlug } from './slug.ts'

/** Settings field in `friend-persona` that names the active character slug. */
export const CURRENT_PERSONA_SLUG_FIELD = 'currentSlug' as const

export const PERSONA_SECTION_NAME = 'friend:persona'
export const CONDUCT_SECTION_NAME = 'friend:conduct'

/**
 * Order 10: after harness identity (`-100`) and the official deployment
 * persona slot (`0` / `deployment:persona`), before tool guidance (`100–199`).
 *
 * We do **not** reuse the name `deployment:persona`. That reserved slot is how
 * a preset replaces the coding-agent identity (the official
 * `@deepseek-ai/dsh-persona` row in `agent.cordis.yml`). Occupying it here
 * would hide that identity row and couple the character card to a name the
 * harness treats as a complete persona replacement.
 */
export const PERSONA_SECTION_ORDER = 10

/**
 * Order 20: immediately after the character card, still before tool
 * guidance (`100–199`), so conduct is read as part of "who she is" rather
 * than as tool help.
 */
export const CONDUCT_SECTION_ORDER = 20

/** Standard 7-word expression vocabulary (stage spec / pet page). */
export const EXPRESSION_VOCABULARY = [
  'neutral',
  'happy',
  'shy',
  'sad',
  'surprised',
  'sleepy',
  'angry',
] as const

export interface PersonaSectionSource {
  /** Already-resolved friend data root (`…/friend`). */
  dataDir: string
  /** Active character slug. Defaults to {@link resolveCurrentPersonaSlug}. */
  getCurrentSlug?: () => string
}

export interface FriendPersonaSettingsReader {
  get(namespace: string): unknown
}

/**
 * Read the active character slug from `friend-persona.currentSlug`.
 * Missing / blank / illegal values fall back to the built-in default slug.
 */
export function resolveCurrentPersonaSlug(
  settings: FriendPersonaSettingsReader | undefined,
): string {
  if (settings === undefined) {
    return DEFAULT_PERSONA_SLUG
  }
  try {
    const section = settings.get(FRIEND_SETTINGS_NAMESPACES.persona)
    const slug = readCurrentSlug(section)
    if (slug === undefined) {
      return DEFAULT_PERSONA_SLUG
    }
    assertSafeSlug(slug)
    return slug
  } catch {
    return DEFAULT_PERSONA_SLUG
  }
}

/**
 * Render the character-card section. Reads disk on every call so an external
 * editor change is visible at the next assembly (no registration-time snapshot).
 *
 * `text` is a function because official `PromptSection.text` is evaluated
 * per assemble; a string would freeze the card at `apply()` time.
 */
export function renderPersonaSectionText(source: PersonaSectionSource): string {
  const slug = source.getCurrentSlug?.() ?? DEFAULT_PERSONA_SLUG
  const persona = readPersonaSync(source.dataDir, slug)
  const beliefs = readBeliefsSync(source.dataDir, slug)
  return formatPersonaSection(persona, beliefs)
}

export function formatPersonaSection(persona: Persona, beliefs: string | undefined): string {
  const lines = [
    '# 人格',
    '',
    `- 名字：${persona.name}`,
    `- 称呼用户：${persona.nickname}`,
    `- 语言：${persona.language}`,
    `- 性格：${persona.personality}`,
    `- 背景：${persona.background}`,
    `- 说话语气：${persona.speakingStyle}`,
  ]
  if (persona.greetings.length > 0) {
    lines.push(`- 招呼：${persona.greetings.join(' / ')}`)
  }
  if (beliefs !== undefined && beliefs.trim().length > 0) {
    lines.push('', '# 信念', '', beliefs.trim())
  }
  return `${lines.join('\n')}\n`
}

export function renderConductSectionText(source: PersonaSectionSource): string {
  const slug = source.getCurrentSlug?.() ?? DEFAULT_PERSONA_SLUG
  const persona = readPersonaSync(source.dataDir, slug)
  return formatConductSection(persona)
}

export function formatConductSection(persona: Persona): string {
  const expressions = EXPRESSION_VOCABULARY.join(' / ')
  return [
    '# 行为守则',
    '',
    '## 表情标签协议',
    '需要表演时，在回复中插入且仅插入这些标签，不要用自然语言描述表情或动作：',
    `- 表情：\`[expr:<词>]\`，词表限 ${expressions}`,
    '- 动作：`[motion:<组名>]`',
    '- 演出：`[cue:<演出名>]`',
    '标签只驱动舞台。屏幕可见文本和将要朗读的文本都不得残留标签。',
    '也可以改用工具 `set_expression` / `play_motion` / `play_cue`。',
    '',
    '## 记忆记录守则',
    '用户明确要求记住的事、约定、忌口、重要日期，必须调用 `memory_append` 落盘。',
    '- 当天小事、随口笔记 → `target: daily`',
    '- 长期事实、关系约定 → `target: longterm`',
    '不要只在口头答应「记住了」而不写文件。检索用 `memory_search`，读片段用 `memory_get`。',
    '',
    '## 语言约束',
    `用「${persona.language}」说话，称呼用户为「${persona.nickname}」。`,
    '先接住情绪，再补充信息。不要扮演编码助手，不要主动改用户的仓库。',
    '',
  ].join('\n')
}

/**
 * Register both friend prompt sections on the **calling** context.
 *
 * Must run on the companion preset's standing mount (or `agent.ctx`).
 * Calling this on the host-global ctx leaks persona text into coding sessions.
 *
 * Official `section()` is already a Cordis effect disposer — this function
 * returns a combined disposer and does not wrap `ctx.effect`.
 */
export function registerPersonaSections(
  ctx: FriendPromptContext,
  source: PersonaSectionSource,
): () => void {
  const disposePersona = registerPromptSection(ctx, {
    name: PERSONA_SECTION_NAME,
    order: PERSONA_SECTION_ORDER,
    text: () => renderPersonaSectionText(source),
  })
  const disposeConduct = registerPromptSection(ctx, {
    name: CONDUCT_SECTION_NAME,
    order: CONDUCT_SECTION_ORDER,
    text: () => renderConductSectionText(source),
  })
  return () => {
    disposeConduct()
    disposePersona()
  }
}

function readPersonaSync(dataDir: string, slug: string): Persona {
  try {
    assertSafeSlug(slug)
    const raw = readFileSync(personaFilePath(dataDir, slug), 'utf8')
    return validatePersona(JSON.parse(raw) as unknown)
  } catch {
    return DEFAULT_PERSONA
  }
}

function readBeliefsSync(dataDir: string, slug: string): string | undefined {
  try {
    assertSafeSlug(slug)
    const raw = readFileSync(beliefsFilePath(dataDir, slug), 'utf8')
    const trimmed = raw.trim()
    return trimmed.length > 0 ? raw : undefined
  } catch {
    return undefined
  }
}

function readCurrentSlug(section: unknown): string | undefined {
  if (section === undefined || section === null) {
    return undefined
  }
  if (typeof section !== 'object' || Array.isArray(section)) {
    return undefined
  }
  const value = (section as Record<string, unknown>)[CURRENT_PERSONA_SLUG_FIELD]
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
