import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { PluginCardCharacter } from './plugin-card.ts'

export type PersonaCard = {
  slug: string
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

export async function listCharacters(dataDir: string): Promise<PluginCardCharacter[]> {
  const root = join(dataDir, 'characters')
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const characters: PluginCardCharacter[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const slug = entry.name
    const personaPath = join(root, slug, 'persona.json')
    let name = slug
    try {
      const raw = JSON.parse(await readFile(personaPath, 'utf8')) as unknown
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
        const record = raw as Record<string, unknown>
        if (typeof record.name === 'string' && record.name.trim().length > 0) {
          name = record.name.trim()
        }
      }
    } catch {
      // missing or illegal card — still list the slug
    }
    characters.push({ slug, name })
  }
  return characters.sort((left, right) => left.slug.localeCompare(right.slug, 'en'))
}

export function defaultPersonaCard(slug: string): PersonaCard {
  return asPersonaCard(assertSafeCharacterSlug(slug), {})
}

export async function readPersonaCard(dataDir: string, slug: string): Promise<PersonaCard | undefined> {
  const safe = assertSafeCharacterSlug(slug)
  try {
    const raw = JSON.parse(await readFile(personaFilePath(dataDir, safe), 'utf8')) as unknown
    return asPersonaCard(safe, raw)
  } catch {
    return undefined
  }
}

export async function writePersonaCard(
  dataDir: string,
  slug: string,
  input: Record<string, unknown>,
): Promise<PersonaCard> {
  const safe = assertSafeCharacterSlug(slug)
  const card = asPersonaCard(safe, { ...input, slug: safe })
  if (card.name.trim().length === 0) {
    throw new Error('name is required')
  }
  const dir = join(dataDir, 'characters', safe)
  await mkdir(dir, { recursive: true })
  const body: Record<string, unknown> = {
    name: card.name,
    personality: card.personality,
    background: card.background,
    speakingStyle: card.speakingStyle,
    language: card.language,
    nickname: card.nickname,
    greetings: card.greetings,
    tags: card.tags,
  }
  if (card.live2dModel !== undefined) body.live2dModel = card.live2dModel
  if (card.voice !== undefined) body.voice = card.voice
  await writeFile(personaFilePath(dataDir, safe), `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  return card
}

export function assertSafeCharacterSlug(slug: string): string {
  const trimmed = slug.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(trimmed)) {
    throw new Error('illegal character slug')
  }
  return trimmed
}

function personaFilePath(dataDir: string, slug: string): string {
  return join(dataDir, 'characters', slug, 'persona.json')
}

function asPersonaCard(slug: string, raw: unknown): PersonaCard {
  const record = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  const greetings = asStringArray(record.greetings)
  const tags = asStringArray(record.tags)
  const live2dModel = typeof record.live2dModel === 'string' && record.live2dModel.trim().length > 0
    ? record.live2dModel.trim()
    : undefined
  const voice = typeof record.voice === 'string' && record.voice.trim().length > 0
    ? record.voice.trim()
    : undefined
  return {
    slug,
    name: asString(record.name, slug),
    personality: asString(record.personality, ''),
    background: asString(record.background, ''),
    speakingStyle: asString(record.speakingStyle, ''),
    language: asString(record.language, 'zh-CN'),
    nickname: asString(record.nickname, '你'),
    greetings,
    tags,
    ...(live2dModel !== undefined ? { live2dModel } : {}),
    ...(voice !== undefined ? { voice } : {}),
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.split('\n').map((item) => item.trim()).filter((item) => item.length > 0)
  }
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}
