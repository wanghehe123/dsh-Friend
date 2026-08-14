import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { PluginCardCharacter } from './plugin-card.ts'

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
