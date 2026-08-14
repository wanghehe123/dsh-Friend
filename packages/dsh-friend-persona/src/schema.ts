/**
 * Persona card schema.
 *
 * Hand-written guards (no zod, no runtime `@deepseek-ai/schemastery`).
 * Feature packages must not runtime-import `@deepseek-ai/*`; schemastery is
 * reserved for the shared compat / settings seam. A local guard keeps this
 * package dependency-free and rejects writes before they touch disk.
 */

export type Persona = {
  name: string
  personality: string
  background: string
  speakingStyle: string
  language: string
  nickname: string
  greetings: string[]
  live2dModel?: string
  voice?: string
  tags: string[]
}

export type PersonaRecord = Persona & {
  slug: string
}

export const PERSONA_FIELDS = [
  'name',
  'personality',
  'background',
  'speakingStyle',
  'language',
  'nickname',
  'greetings',
  'live2dModel',
  'voice',
  'tags',
] as const

export type PersonaField = (typeof PERSONA_FIELDS)[number]

const REQUIRED_STRING_FIELDS = [
  'name',
  'personality',
  'background',
  'speakingStyle',
  'language',
  'nickname',
] as const satisfies readonly PersonaField[]

const REQUIRED_STRING_ARRAY_FIELDS = ['greetings', 'tags'] as const satisfies readonly PersonaField[]

const OPTIONAL_STRING_FIELDS = ['live2dModel', 'voice'] as const satisfies readonly PersonaField[]

export class PersonaValidationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    const headline = issues.length === 1 ? issues[0] : undefined
    super(headline ?? `非法角色卡：${issues.join('；')}`)
    this.name = 'PersonaValidationError'
    this.issues = issues
  }
}

export function isPersona(input: unknown): input is Persona {
  return collectPersonaIssues(input).length === 0
}

/** Validate and return a normalized persona. Throws {@link PersonaValidationError}. */
export function validatePersona(input: unknown): Persona {
  const issues = collectPersonaIssues(input)
  if (issues.length > 0) {
    throw new PersonaValidationError(issues)
  }
  return normalizePersona(input as Record<string, unknown>)
}

export function collectPersonaIssues(input: unknown): string[] {
  if (!isRecord(input)) {
    return ['角色卡必须是对象']
  }

  const issues: string[] = []

  for (const field of REQUIRED_STRING_FIELDS) {
    if (!(field in input)) {
      issues.push(`缺少 ${field} 字段`)
      continue
    }
    const value = input[field]
    if (typeof value !== 'string') {
      issues.push(`${field} 必须是字符串`)
      continue
    }
    if (field === 'name' && value.trim().length === 0) {
      issues.push('name 不能为空')
    }
  }

  for (const field of REQUIRED_STRING_ARRAY_FIELDS) {
    if (!(field in input)) {
      issues.push(`缺少 ${field} 字段`)
      continue
    }
    const value = input[field]
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      issues.push(`${field} 必须是字符串数组`)
    }
  }

  for (const field of OPTIONAL_STRING_FIELDS) {
    if (!(field in input) || input[field] === undefined) continue
    if (typeof input[field] !== 'string') {
      issues.push(`${field} 必须是字符串`)
    }
  }

  return issues
}

export function serializePersona(persona: Persona): string {
  const body: Record<string, unknown> = {
    name: persona.name,
    personality: persona.personality,
    background: persona.background,
    speakingStyle: persona.speakingStyle,
    language: persona.language,
    nickname: persona.nickname,
    greetings: persona.greetings,
    tags: persona.tags,
  }
  if (persona.live2dModel !== undefined) body.live2dModel = persona.live2dModel
  if (persona.voice !== undefined) body.voice = persona.voice
  return `${JSON.stringify(body, null, 2)}\n`
}

function normalizePersona(input: Record<string, unknown>): Persona {
  const persona: Persona = {
    name: (input.name as string).trim(),
    personality: input.personality as string,
    background: input.background as string,
    speakingStyle: input.speakingStyle as string,
    language: input.language as string,
    nickname: input.nickname as string,
    greetings: [...(input.greetings as string[])],
    tags: [...(input.tags as string[])],
  }
  const live2dModel = optionalNonEmptyString(input.live2dModel)
  const voice = optionalNonEmptyString(input.voice)
  if (live2dModel !== undefined) persona.live2dModel = live2dModel
  if (voice !== undefined) persona.voice = voice
  return persona
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
