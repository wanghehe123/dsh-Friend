import { HIYORI_EXPRESSIONS, type HiyoriExpression } from './tag-vocab.ts'

export const DEFAULT_MOUTH_OPEN_PARAM = 'ParamMouthOpenY'
export const FRIEND_MAP_FILE = 'friend.map.json'

export type FriendExpressionMap = Partial<Record<HiyoriExpression, string>>
export type FriendMotionMap = Record<string, readonly string[]>

export type FriendModelMap = Readonly<{
  mouthOpenParam: string
  expressions: FriendExpressionMap
  motions: FriendMotionMap
}>

export type Model3FileReferences = Readonly<{
  Expressions?: readonly Readonly<{ Name?: string; File?: string }>[]
  Motions?: Readonly<Record<string, readonly Readonly<{ File?: string }>[]>>
  Parameters?: readonly Readonly<{ Id?: string }>[]
}>

export type Model3Document = Readonly<{
  Version?: unknown
  FileReferences?: Model3FileReferences
}>

const EXPRESSION_ALIASES: Readonly<Record<HiyoriExpression, readonly string[]>> = {
  neutral: ['neutral', 'idle', 'normal', 'default'],
  happy: ['happy', 'smile', 'joy', 'laugh'],
  shy: ['shy', 'embarrassed', 'blush'],
  sad: ['sad', 'cry', 'sorrow'],
  surprised: ['surprised', 'surprise', 'shock', 'error'],
  sleepy: ['sleepy', 'sleep', 'tired'],
  angry: ['angry', 'mad', 'rage'],
}

export function isModel3Document(value: unknown): value is Model3Document {
  if (typeof value !== 'object' || value === null) return false
  return true
}

export function findMouthOpenParam(document: Model3Document): string {
  const parameters = document.FileReferences?.Parameters
  if (parameters) {
    for (const parameter of parameters) {
      if (parameter.Id === DEFAULT_MOUTH_OPEN_PARAM) return DEFAULT_MOUTH_OPEN_PARAM
    }
    for (const parameter of parameters) {
      const id = parameter.Id
      if (typeof id === 'string' && /mouth/i.test(id) && /open/i.test(id)) return id
    }
  }
  return DEFAULT_MOUTH_OPEN_PARAM
}

/** Scan a model3.json document and build the default friend.map.json payload. */
export function generateDefaultFriendMap(document: Model3Document): FriendModelMap {
  return {
    mouthOpenParam: findMouthOpenParam(document),
    expressions: mapExpressions(document),
    motions: mapMotions(document),
  }
}

export function parseModel3Json(raw: string): Model3Document {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('model3.json is not valid JSON')
  }
  if (!isModel3Document(parsed)) {
    throw new Error('model3.json must be a JSON object')
  }
  return parsed
}

function mapExpressions(document: Model3Document): FriendExpressionMap {
  const listed = document.FileReferences?.Expressions ?? []
  const out: FriendExpressionMap = {}
  for (const word of HIYORI_EXPRESSIONS) {
    const aliases = EXPRESSION_ALIASES[word]
    const match = listed.find((entry) => {
      const name = (entry.Name ?? entry.File ?? '').toLowerCase()
      return aliases.some((alias) => name.includes(alias))
    })
    if (match?.File) {
      out[word] = match.File
    }
  }
  return out
}

function mapMotions(document: Model3Document): FriendMotionMap {
  const motions = document.FileReferences?.Motions
  if (motions === undefined) return {}
  const out: Record<string, string[]> = {}
  for (const [group, files] of Object.entries(motions)) {
    out[group] = files
      .map((entry) => entry.File)
      .filter((file): file is string => typeof file === 'string' && file.length > 0)
  }
  return out
}
