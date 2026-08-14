/**
 * SillyTavern character-card parser, ported from Kokoro-Engine
 * `src/lib/character-card-parser.ts` (PNG tEXt/iTXt + JSON, v1/v2/v3).
 *
 * The legacy functions keep the old return shape (`name` / `persona` blob /
 * `user_nickname` / `source_format`) so those behavioral cases can be locked.
 * `importTavernCard*` maps the same card onto the persona schema with
 * documented fallbacks and always runs {@link validatePersona}.
 */
import { validatePersona, type Persona } from './schema.ts'

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

export type TavernSourceFormat = 'tavern-v2' | 'tavern-v3'

/** Legacy Kokoro `CharacterRecord` slice produced by the original parser. */
export type TavernCardProfile = {
  name: string
  persona: string
  user_nickname: string
  source_format: TavernSourceFormat
}

export const TAVERN_IMPORT_FALLBACKS = {
  name: 'Unnamed Character',
  personality: '',
  background: '',
  speakingStyle: '',
  language: 'zh-CN',
  nickname: '你',
  greetings: [] as readonly string[],
  tags: [] as readonly string[],
} as const

export const TAVERN_DEFAULT_USER_NICKNAME = '{{user}}'

/**
 * Parse a raw JSON string containing a SillyTavern character card.
 * Return shape matches the Kokoro parser (combined `persona` blob).
 */
export function parseCharacterCardJSON(jsonStr: string): TavernCardProfile {
  return mapCardToProfile(parseJsonObject(jsonStr, 'character card JSON'))
}

/**
 * Parse a PNG buffer and extract the embedded SillyTavern character card.
 * Looks for a `chara` (then `ccv3`) keyword in tEXt / iTXt chunks.
 */
export function parseCharacterCardPngBuffer(buffer: ArrayBuffer | Uint8Array): TavernCardProfile {
  return mapCardToProfile(extractPngCard(toArrayBuffer(buffer)))
}

/**
 * Parse a PNG file and extract the embedded SillyTavern character card.
 * Preserves the Kokoro `File` entry point (Node 22+ / browser).
 */
export async function parseCharacterCardPNG(file: File): Promise<TavernCardProfile> {
  return parseCharacterCardPngBuffer(await file.arrayBuffer())
}

/**
 * Detect whether a File is a character card JSON or PNG, and parse accordingly.
 */
export async function parseCharacterCard(file: File): Promise<TavernCardProfile> {
  const ext = file.name.toLowerCase().split('.').pop()

  if (ext === 'json') {
    return parseCharacterCardJSON(await file.text())
  }

  if (ext === 'png') {
    return parseCharacterCardPNG(file)
  }

  throw new Error(`Unsupported file format: .${ext}. Expected .json or .png`)
}

export function importTavernCardJson(jsonStr: string): Persona {
  return validatePersona(mapCardToPersona(parseJsonObject(jsonStr, '酒馆卡 JSON')))
}

export function importTavernCardPng(buffer: ArrayBuffer | Uint8Array): Persona {
  return validatePersona(mapCardToPersona(extractPngCard(toArrayBuffer(buffer))))
}

export async function importTavernCard(file: File): Promise<Persona> {
  const ext = file.name.toLowerCase().split('.').pop()

  if (ext === 'json') {
    return importTavernCardJson(await file.text())
  }

  if (ext === 'png') {
    return importTavernCardPng(await file.arrayBuffer())
  }

  throw new Error(`Unsupported file format: .${ext}. Expected .json or .png`)
}

function toArrayBuffer(buffer: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (buffer instanceof ArrayBuffer) return buffer
  const copy = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(copy).set(buffer)
  return copy
}

function parseJsonObject(jsonStr: string, label: string): unknown {
  try {
    return JSON.parse(jsonStr)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} 无法解析：${message}`)
  }
}

function extractPngCard(buffer: ArrayBuffer): unknown {
  if (!isPng(buffer)) {
    throw new Error('Not a valid PNG file')
  }

  const chunks = extractPngTextChunks(buffer)
  const charaData = chunks.get('chara') ?? chunks.get('ccv3')

  if (charaData === undefined) {
    throw new Error('No "chara" metadata found in PNG. This may not be a SillyTavern character card.')
  }

  let jsonStr: string
  try {
    jsonStr = atob(charaData)
  } catch {
    jsonStr = charaData
  }

  try {
    jsonStr = decodeURIComponent(
      Array.from(jsonStr)
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    )
  } catch {
    // If decoding fails, use as-is (Kokoro behavior).
  }

  return parseJsonObject(jsonStr, 'PNG 内嵌角色卡')
}

function isPng(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < PNG_SIGNATURE.byteLength) return false
  const header = new Uint8Array(buffer, 0, PNG_SIGNATURE.byteLength)
  return header.every((byte, index) => byte === PNG_SIGNATURE[index])
}

/**
 * Walk PNG chunks and extract tEXt / iTXt entries.
 * Ported from Kokoro; compressed iTXt is still best-effort UTF-8 (no zlib).
 */
function extractPngTextChunks(buffer: ArrayBuffer): Map<string, string> {
  const view = new DataView(buffer)
  const decoder = new TextDecoder('latin1')
  const utf8Decoder = new TextDecoder('utf-8')
  const result = new Map<string, string>()

  let offset = 8

  while (offset < buffer.byteLength - 4) {
    const chunkLength = view.getUint32(offset)
    const chunkTypeBytes = new Uint8Array(buffer, offset + 4, 4)
    const chunkType = decoder.decode(chunkTypeBytes)

    const dataStart = offset + 8
    const dataEnd = dataStart + chunkLength
    if (dataEnd > buffer.byteLength) break

    if (chunkType === 'tEXt') {
      const data = new Uint8Array(buffer, dataStart, chunkLength)
      const nullIdx = data.indexOf(0)
      if (nullIdx !== -1) {
        const keyword = decoder.decode(data.slice(0, nullIdx))
        const value = decoder.decode(data.slice(nullIdx + 1))
        result.set(keyword, value)
      }
    } else if (chunkType === 'iTXt') {
      const data = new Uint8Array(buffer, dataStart, chunkLength)
      const nullIdx = data.indexOf(0)
      if (nullIdx !== -1) {
        const keyword = decoder.decode(data.slice(0, nullIdx))
        const compressionFlag = data[nullIdx + 1]
        let pos = nullIdx + 3
        while (pos < data.length && data[pos] !== 0) pos += 1
        pos += 1
        while (pos < data.length && data[pos] !== 0) pos += 1
        pos += 1
        const textBytes = data.slice(pos)
        if (compressionFlag === 0) {
          result.set(keyword, utf8Decoder.decode(textBytes))
        } else {
          try {
            result.set(keyword, utf8Decoder.decode(textBytes))
          } catch {
            // Kokoro logged a warning; host-side we skip the chunk.
          }
        }
      }
    }

    if (chunkType === 'IEND') break
    offset = dataEnd + 4
  }

  return result
}

function unwrapCard(card: unknown): { card: Record<string, unknown>; data: Record<string, unknown> } {
  const record = asRecord(card) ?? {}
  const nested = asRecord(record.data)
  return { card: record, data: nested ?? record }
}

function mapCardToProfile(card: unknown): TavernCardProfile {
  const { card: raw, data } = unwrapCard(card)
  const name = coalesceLegacyName(data)

  const parts: string[] = []
  const systemPrompt = asString(data.system_prompt)
  if (systemPrompt) parts.push(systemPrompt)

  const description = firstString(data.description, data.char_persona) ?? ''
  if (description) parts.push(description)

  const personality = asString(data.personality)
  if (personality) parts.push(`Personality: ${personality}`)

  const scenario = firstString(data.scenario, data.world_scenario) ?? ''
  if (scenario) parts.push(`Scenario: ${scenario}`)

  const greeting = firstString(data.first_mes, data.char_greeting) ?? ''
  if (greeting) parts.push(`First greeting: ${greeting}`)

  const examples = firstString(data.mes_example, data.example_dialogue) ?? ''
  if (examples) parts.push(`Example dialogue:\n${examples}`)

  return {
    name,
    persona: parts.join('\n\n'),
    user_nickname: TAVERN_DEFAULT_USER_NICKNAME,
    source_format: isTavernV3(raw, data) ? 'tavern-v3' : 'tavern-v2',
  }
}

function mapCardToPersona(card: unknown): Persona {
  const { data } = unwrapCard(card)
  const extensions = asRecord(data.extensions) ?? {}

  const description = firstString(data.description, data.char_persona) ?? ''
  const scenario = firstString(data.scenario, data.world_scenario) ?? ''
  const backgroundParts = [description, scenario].filter((part) => part.length > 0)

  const systemPrompt = asString(data.system_prompt)
  const postHistory = asString(data.post_history_instructions)
  const examples = firstString(data.mes_example, data.example_dialogue) ?? ''
  const styleParts: string[] = []
  if (systemPrompt) styleParts.push(systemPrompt)
  else if (postHistory) styleParts.push(postHistory)
  if (examples) styleParts.push(`Example dialogue:\n${examples}`)

  const firstGreeting = firstString(data.first_mes, data.char_greeting)
  const alternate = asStringArray(data.alternate_greetings)
  const greetings = [
    ...(firstGreeting ? [firstGreeting] : []),
    ...alternate,
  ]

  const nickname = firstString(extensions.nickname, data.user_nickname)
  const mappedNickname = nickname === undefined || nickname === TAVERN_DEFAULT_USER_NICKNAME
    ? TAVERN_IMPORT_FALLBACKS.nickname
    : nickname

  const live2dModel = firstString(extensions.live2dModel, extensions.live2d)
  const voice = firstString(extensions.voice, data.voice)

  const persona: Persona = {
    name: firstString(data.name, data.char_name) ?? TAVERN_IMPORT_FALLBACKS.name,
    personality: asString(data.personality) ?? TAVERN_IMPORT_FALLBACKS.personality,
    background: backgroundParts.join('\n\n'),
    speakingStyle: styleParts.join('\n\n'),
    language: firstString(extensions.language, extensions.speak_language) ?? TAVERN_IMPORT_FALLBACKS.language,
    nickname: mappedNickname,
    greetings,
    tags: asStringArray(data.tags),
  }
  if (live2dModel !== undefined) persona.live2dModel = live2dModel
  if (voice !== undefined) persona.voice = voice
  return persona
}

function coalesceLegacyName(data: Record<string, unknown>): string {
  if (typeof data.name === 'string') return data.name
  if (typeof data.char_name === 'string') return data.char_name
  return TAVERN_IMPORT_FALLBACKS.name
}

function isTavernV3(card: Record<string, unknown>, data: Record<string, unknown>): boolean {
  return card.spec === 'chara_card_v3' || data.spec_version === '3.0'
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function firstString(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    const text = asString(value)
    if (text !== undefined) return text
  }
  return undefined
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}
