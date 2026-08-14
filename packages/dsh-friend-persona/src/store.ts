import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { DEFAULT_PERSONA, DEFAULT_PERSONA_SLUG } from './default-persona.ts'
import { charactersDir, personaFilePath, resolveFriendDataDir, type ResolveFriendDataDirOptions } from './paths.ts'
import {
  PersonaValidationError,
  serializePersona,
  validatePersona,
  type Persona,
  type PersonaRecord,
} from './schema.ts'
import { allocateSlug, assertSafeSlug, slugify } from './slug.ts'

export { DEFAULT_PERSONA, DEFAULT_PERSONA_SLUG } from './default-persona.ts'
export {
  DSH_HOME_ENV,
  FRIEND_DATA_DIR_ENV,
  beliefsFilePath,
  charactersDir,
  personaFilePath,
  resolveDshHome,
  resolveFriendDataDir,
  userAgentPresetsDir,
  USER_AGENT_PRESETS_DIR,
  type ResolveFriendDataDirOptions,
} from './paths.ts'
export {
  PERSONA_FIELDS,
  PersonaValidationError,
  collectPersonaIssues,
  isPersona,
  serializePersona,
  validatePersona,
  type Persona,
  type PersonaField,
  type PersonaRecord,
} from './schema.ts'
export { allocateSlug, assertSafeSlug, slugify } from './slug.ts'

export type PersonaStoreOptions = {
  /** Already-resolved friend data root (`…/friend`). */
  dataDir: string
}

export type SeedDefaultResult = {
  created: boolean
  record: PersonaRecord
}

export function createPersonaStore(options: ResolveFriendDataDirOptions = {}): PersonaStore {
  return new PersonaStore({ dataDir: resolveFriendDataDir(options) })
}

/**
 * File-backed persona CRUD. Every read hits disk — no long-lived card cache —
 * so an external editor change is visible on the next `get` / `list`.
 */
export class PersonaStore {
  readonly dataDir: string

  constructor(options: PersonaStoreOptions) {
    this.dataDir = options.dataDir
  }

  charactersDir(): string {
    return charactersDir(this.dataDir)
  }

  personaPath(slug: string): string {
    assertSafeSlug(slug)
    return personaFilePath(this.dataDir, slug)
  }

  async list(): Promise<PersonaRecord[]> {
    const root = this.charactersDir()
    if (!await pathExists(root)) return []

    const entries = await readdir(root, { withFileTypes: true })
    const records: PersonaRecord[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const record = await this.get(entry.name)
        if (record !== undefined) records.push(record)
      } catch {
        // One corrupt card must not hide the rest of the roster.
      }
    }
    return records.sort((left, right) => left.slug.localeCompare(right.slug, 'en'))
  }

  async get(slug: string): Promise<PersonaRecord | undefined> {
    assertSafeSlug(slug)
    const filePath = this.personaPath(slug)
    if (!await pathExists(filePath)) return undefined
    return { slug, ...readPersonaFile(await readFile(filePath, 'utf8')) }
  }

  async create(input: Persona, options: { slug?: string } = {}): Promise<PersonaRecord> {
    const persona = validatePersona(input)
    const requested = options.slug
    const base = requested !== undefined && requested.length > 0 ? requested : slugify(persona.name)
    assertSafeSlug(base)
    await mkdir(this.charactersDir(), { recursive: true })
    const slug = allocateSlug(base, await this.listSlugs())
    await mkdir(join(this.charactersDir(), slug), { recursive: true })
    await atomicWritePersona(this.personaPath(slug), persona)
    return { slug, ...persona }
  }

  async update(slug: string, input: Persona): Promise<PersonaRecord> {
    assertSafeSlug(slug)
    const persona = validatePersona(input)
    const filePath = this.personaPath(slug)
    if (!await pathExists(filePath)) {
      throw new Error(`角色不存在：${slug}`)
    }
    await atomicWritePersona(filePath, persona)
    return { slug, ...persona }
  }

  async remove(slug: string): Promise<boolean> {
    assertSafeSlug(slug)
    const dir = join(this.charactersDir(), slug)
    if (!await pathExists(dir)) return false
    await rm(dir, { recursive: true, force: true })
    return true
  }

  /**
   * First-start seed. Writes `characters/default/persona.json` only when that
   * file is missing. Existing files — including user edits — are left intact.
   */
  async seedDefault(): Promise<SeedDefaultResult> {
    const filePath = this.personaPath(DEFAULT_PERSONA_SLUG)
    if (await pathExists(filePath)) {
      const record = await this.get(DEFAULT_PERSONA_SLUG)
      if (record === undefined) {
        throw new Error(`默认角色文件存在但无法读取：${filePath}`)
      }
      return { created: false, record }
    }

    await mkdir(join(this.charactersDir(), DEFAULT_PERSONA_SLUG), { recursive: true })
    const persona = validatePersona(DEFAULT_PERSONA)
    await atomicWritePersona(filePath, persona)
    return { created: true, record: { slug: DEFAULT_PERSONA_SLUG, ...persona } }
  }

  private async listSlugs(): Promise<string[]> {
    const root = this.charactersDir()
    if (!await pathExists(root)) return []
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  }
}

function readPersonaFile(raw: string): Persona {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new PersonaValidationError([`persona.json 不是合法 JSON：${message}`])
  }
  return validatePersona(parsed)
}

async function atomicWritePersona(filePath: string, persona: Persona): Promise<void> {
  const directory = dirname(filePath)
  await mkdir(directory, { recursive: true })
  const tmpPath = `${filePath}.${randomBytes(8).toString('hex')}.tmp`
  try {
    await writeFile(tmpPath, serializePersona(persona), 'utf8')
    await rename(tmpPath, filePath)
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
