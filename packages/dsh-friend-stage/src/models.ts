import { existsSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  formatMocVersionError,
  moc3ExceedsRuntime,
  readMoc3Version,
  RUNTIME_MAX_MOC_VERSION,
} from './live2d/moc3-version.ts'
import { extractZipToDirectory, ZipSlipError } from './live2d/unzip-safe.ts'
import {
  FRIEND_MAP_FILE,
  generateDefaultFriendMap,
  parseModel3Json,
  type FriendModelMap,
} from './model-map.ts'

/** WBS W-M4-3 archive size cap (compressed upload and uncompressed total). */
export const MAX_MODEL_ZIP_BYTES = 200 * 1024 * 1024
export const BUILTIN_HIYORI_NAME = 'hiyori'
export const BUILTIN_HIYORI_LABEL = 'Hiyori'
export const BUILTIN_HIYORI_MODEL3 =
  'vendor/hiyori/hiyori_free/runtime/hiyori_free_t08.model3.json'
export const BUILTIN_NAILONG_NAME = 'nailong'
export const BUILTIN_NAILONG_LABEL = '奶龙'
export const BUILTIN_NAILONG_DIR = 'vendor/nailong'
export const NAILONG_RUNTIME_ZIP = 'naiwa-live2d-v3-sdk4.2-runtime.zip'
export const MODELS_DIR = 'models'
export const CATALOG_FILE = 'models/catalog.json'

const RESERVED_NAMES = new Set([
  BUILTIN_HIYORI_NAME,
  BUILTIN_NAILONG_NAME,
  'vendor',
  'catalog',
  'current',
  'index',
])

const nailongInstalls = new Map<string, Promise<InstalledModel | undefined>>()

export type ModelKind = 'builtin' | 'user'

export type InstalledModel = Readonly<{
  name: string
  kind: ModelKind
  label?: string
  model3Relative: string
  modelUrl: string
}>

export type ModelCatalog = Readonly<{
  current: string
  models: readonly InstalledModel[]
}>

export type UploadModelOptions = Readonly<{
  dataRoot: string
  archive: Uint8Array
  name?: string
  maxBytes?: number
}>

export type UploadModelResult = Readonly<{
  name: string
  model3Relative: string
  map: FriendModelMap
  catalog: ModelCatalog
}>

export class ModelUploadError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'ModelUploadError'
    this.statusCode = statusCode
  }
}

export function sanitizeModelName(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64)
  if (slug.length === 0 || !/^[a-z0-9]/u.test(slug)) {
    throw new ModelUploadError('Model name must start with a letter or digit')
  }
  if (RESERVED_NAMES.has(slug)) {
    throw new ModelUploadError(`Model name "${slug}" is reserved`)
  }
  return slug
}

export function builtinHiyori(): InstalledModel {
  return {
    name: BUILTIN_HIYORI_NAME,
    kind: 'builtin',
    label: BUILTIN_HIYORI_LABEL,
    model3Relative: BUILTIN_HIYORI_MODEL3,
    modelUrl: `/friend/assets/${BUILTIN_HIYORI_MODEL3}`,
  }
}

export function builtinNailong(model3Relative = `${BUILTIN_NAILONG_DIR}/naiwa-live2d-v3.model3.json`): InstalledModel {
  return {
    name: BUILTIN_NAILONG_NAME,
    kind: 'builtin',
    label: BUILTIN_NAILONG_LABEL,
    model3Relative,
    modelUrl: `/friend/assets/${model3Relative}`,
  }
}

/** Walk up from the package looking for the first-party 奶龙 runtime zip. */
export function resolveBundledNailongZip(fromUrl = import.meta.url): string | undefined {
  const fromEnv = process.env.FRIEND_NAILONG_ZIP
  if (typeof fromEnv === 'string' && fromEnv.length > 0 && existsSync(fromEnv)) {
    return fromEnv
  }
  let dir = dirname(fileURLToPath(fromUrl))
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'models', 'naiwa-live2d', NAILONG_RUNTIME_ZIP)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

export type EnsureNailongOptions = Readonly<{
  dataRoot: string
  archive?: Uint8Array
  zipPath?: string
}>

/**
 * Extract the 奶龙 runtime zip into `vendor/nailong/` once. The zip stays in
 * git, never in the npm tarball; missing zip is a no-op so npm-only installs
 * still boot with Hiyori.
 */
export async function ensureBuiltinNailong(options: EnsureNailongOptions): Promise<InstalledModel | undefined> {
  const existing = await readInstalledNailong(options.dataRoot)
  if (existing !== undefined) return existing

  const archive = options.archive ?? await readNailongArchive(options.zipPath)
  if (archive === undefined || archive.byteLength === 0) return undefined

  const staging = await mkdtemp(join(tmpdir(), 'dsh-friend-nailong-'))
  try {
    try {
      await extractZipToDirectory(archive, staging)
    } catch (error) {
      if (error instanceof ZipSlipError) {
        throw new ModelUploadError(`Refusing zip-slip entry: ${error.entryName}`)
      }
      throw new ModelUploadError(error instanceof Error ? error.message : String(error))
    }
    await flattenSingleRoot(staging)
    const model3Relative = await findModel3Relative(staging)
    if (model3Relative === undefined) {
      throw new ModelUploadError('奶龙 zip must contain a *.model3.json file')
    }
    const document = parseModel3Json(await readFile(join(staging, model3Relative), 'utf8'))
    await assertSupportedMoc3(staging, model3Relative, document)
    const dest = join(options.dataRoot, BUILTIN_NAILONG_DIR)
    await mkdir(dirname(dest), { recursive: true })
    await rm(dest, { recursive: true, force: true })
    await movePath(staging, dest)
    return await readInstalledNailong(options.dataRoot)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

export function scheduleBuiltinNailongInstall(dataRoot: string, zipPath = resolveBundledNailongZip()): Promise<InstalledModel | undefined> {
  const existing = nailongInstalls.get(dataRoot)
  if (existing !== undefined) return existing
  const pending = ensureBuiltinNailong({
    dataRoot,
    ...(zipPath === undefined ? {} : { zipPath }),
  }).catch((error: unknown) => {
    nailongInstalls.delete(dataRoot)
    throw error
  })
  nailongInstalls.set(dataRoot, pending)
  return pending
}

export function pendingBuiltinNailongInstall(dataRoot: string): Promise<InstalledModel | undefined> | undefined {
  return nailongInstalls.get(dataRoot)
}

export async function readModelCatalog(dataRoot: string): Promise<ModelCatalog> {
  const nailong = await readInstalledNailong(dataRoot)
  const models = [
    builtinHiyori(),
    ...(nailong === undefined ? [] : [nailong]),
    ...await listUserModels(dataRoot),
  ]
  const stored = await readCatalogFile(dataRoot)
  const current = models.some((model) => model.name === stored)
    ? stored
    : BUILTIN_HIYORI_NAME
  return { current, models }
}

export async function selectCurrentModel(dataRoot: string, name: string): Promise<ModelCatalog> {
  const catalog = await readModelCatalog(dataRoot)
  if (!catalog.models.some((model) => model.name === name)) {
    throw new ModelUploadError(`Unknown model "${name}"`, 404)
  }
  await writeCatalogFile(dataRoot, name)
  return { ...catalog, current: name }
}

export async function deleteUserModel(dataRoot: string, name: string): Promise<ModelCatalog> {
  if (name === BUILTIN_HIYORI_NAME) {
    throw new ModelUploadError('Cannot delete the built-in Hiyori model')
  }
  if (name === BUILTIN_NAILONG_NAME) {
    throw new ModelUploadError('Cannot delete the built-in 奶龙 model')
  }
  const slug = sanitizeModelName(name)
  const target = join(dataRoot, MODELS_DIR, slug)
  if (!await pathExists(target)) {
    throw new ModelUploadError(`Unknown model "${slug}"`, 404)
  }
  const catalog = await readModelCatalog(dataRoot)
  await rm(target, { recursive: true, force: true })
  if (catalog.current === slug) {
    await writeCatalogFile(dataRoot, BUILTIN_HIYORI_NAME)
  }
  return readModelCatalog(dataRoot)
}

export async function resolveCurrentModel(dataRoot: string): Promise<InstalledModel> {
  const catalog = await readModelCatalog(dataRoot)
  return catalog.models.find((model) => model.name === catalog.current) ?? builtinHiyori()
}

export async function readFriendMap(dataRoot: string, model: InstalledModel): Promise<FriendModelMap> {
  if (model.kind === 'builtin' && model.name === BUILTIN_HIYORI_NAME) {
    return generateDefaultFriendMap({
      Version: 3,
      FileReferences: { Motions: HIYORI_MOTION_FIXTURE },
    })
  }
  if (model.kind === 'builtin' && model.name === BUILTIN_NAILONG_NAME) {
    try {
      const model3 = await readFile(join(dataRoot, model.model3Relative), 'utf8')
      return generateDefaultFriendMap(parseModel3Json(model3))
    } catch {
      return NAILONG_DEFAULT_MAP
    }
  }
  const mapPath = join(dataRoot, MODELS_DIR, model.name, FRIEND_MAP_FILE)
  try {
    const raw = await readFile(mapPath, 'utf8')
    return JSON.parse(raw) as FriendModelMap
  } catch {
    const model3 = await readFile(join(dataRoot, model.model3Relative), 'utf8')
    return generateDefaultFriendMap(parseModel3Json(model3))
  }
}

/**
 * Unzip a user model into `models/<name>/` with zip-slip rejection, a 200 MB
 * cap, and a required `*.model3.json`. Staging lives in `os.tmpdir()`.
 */
export async function uploadModelZip(options: UploadModelOptions): Promise<UploadModelResult> {
  const maxBytes = options.maxBytes ?? MAX_MODEL_ZIP_BYTES
  if (options.archive.byteLength === 0) {
    throw new ModelUploadError('Uploaded zip is empty')
  }
  if (options.archive.byteLength > maxBytes) {
    throw new ModelUploadError(`Zip exceeds the ${maxBytes} byte size limit`)
  }

  const staging = await mkdtemp(join(tmpdir(), 'dsh-friend-model-'))
  try {
    try {
      await extractZipToDirectory(options.archive, staging)
    } catch (error) {
      if (error instanceof ZipSlipError) {
        throw new ModelUploadError(`Refusing zip-slip entry: ${error.entryName}`)
      }
      throw new ModelUploadError(error instanceof Error ? error.message : String(error))
    }

    const uncompressed = await directoryBytes(staging)
    if (uncompressed > maxBytes) {
      throw new ModelUploadError(`Uncompressed model exceeds the ${maxBytes} byte size limit`)
    }

    const nestedModel3 = await findModel3Relative(staging)
    await flattenSingleRoot(staging)
    const model3Relative = await findModel3Relative(staging)
    if (model3Relative === undefined) {
      throw new ModelUploadError('Zip must contain a *.model3.json file')
    }

    const document = parseModel3Json(await readFile(join(staging, model3Relative), 'utf8'))
    await assertSupportedMoc3(staging, model3Relative, document)
    const map = generateDefaultFriendMap(document)
    const mapPath = join(staging, FRIEND_MAP_FILE)
    if (!await pathExists(mapPath)) {
      await writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`, 'utf8')
    }

    const name = options.name === undefined || options.name.trim().length === 0
      ? inferNameFromPath(nestedModel3 ?? model3Relative)
      : sanitizeModelName(options.name)
    const dest = join(options.dataRoot, MODELS_DIR, name)
    await mkdir(dirname(dest), { recursive: true })
    await rm(dest, { recursive: true, force: true })
    await movePath(staging, dest)

    await writeCatalogFile(options.dataRoot, name)
    const catalog = await readModelCatalog(options.dataRoot)
    return {
      name,
      model3Relative: `${MODELS_DIR}/${name}/${model3Relative}`,
      map,
      catalog,
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

const HIYORI_MOTION_FIXTURE: NonNullable<NonNullable<Parameters<typeof generateDefaultFriendMap>[0]['FileReferences']>['Motions']> = {
  Idle: [
    { File: 'motion/hiyori_m01.motion3.json' },
    { File: 'motion/hiyori_m02.motion3.json' },
    { File: 'motion/hiyori_m03.motion3.json' },
  ],
  Flick: [{ File: 'motion/hiyori_m04.motion3.json' }],
  FlickDown: [{ File: 'motion/hiyori_m05.motion3.json' }],
  'Flick@Body': [{ File: 'motion/hiyori_m06.motion3.json' }],
  Tap: [{ File: 'motion/hiyori_m07.motion3.json' }],
  'Tap@Body': [{ File: 'motion/hiyori_m08.motion3.json' }],
}

/** Hiyori FREE FileReferences.Motions — used as the default-map snapshot. */
export const HIYORI_DEFAULT_MAP = generateDefaultFriendMap({
  Version: 3,
  FileReferences: { Motions: HIYORI_MOTION_FIXTURE },
})

const NAILONG_MODEL3_FIXTURE = {
  Version: 3,
  FileReferences: {
    Expressions: [
      { Name: 'calm', File: 'expressions/calm.exp3.json' },
      { Name: 'smile', File: 'expressions/smile.exp3.json' },
      { Name: 'surprise', File: 'expressions/surprise.exp3.json' },
    ],
    Motions: { Idle: [{ File: 'motions/idle.motion3.json' }] },
  },
} as const

/** 奶龙 runtime expressions / idle — used when the extracted model3 is missing. */
export const NAILONG_DEFAULT_MAP = generateDefaultFriendMap(NAILONG_MODEL3_FIXTURE)

async function readInstalledNailong(dataRoot: string): Promise<InstalledModel | undefined> {
  const model3 = await findModel3Relative(join(dataRoot, BUILTIN_NAILONG_DIR))
  if (model3 === undefined) return undefined
  return builtinNailong(`${BUILTIN_NAILONG_DIR}/${model3}`)
}

async function readNailongArchive(zipPath: string | undefined): Promise<Uint8Array | undefined> {
  if (zipPath === undefined || zipPath.length === 0) return undefined
  try {
    return await readFile(zipPath)
  } catch {
    return undefined
  }
}

async function listUserModels(dataRoot: string): Promise<InstalledModel[]> {
  const root = join(dataRoot, MODELS_DIR)
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return []
  }
  const models: InstalledModel[] = []
  for (const name of names.sort()) {
    if (name.startsWith('.') || name === 'catalog.json') continue
    const model3 = await findModel3Relative(join(root, name))
    if (model3 === undefined) continue
    const relative = `${MODELS_DIR}/${name}/${model3}`
    models.push({
      name,
      kind: 'user',
      model3Relative: relative,
      modelUrl: `/friend/assets/${relative}`,
    })
  }
  return models
}

async function assertSupportedMoc3(
  staging: string,
  model3Relative: string,
  document: ReturnType<typeof parseModel3Json>,
): Promise<void> {
  const mocName = document.FileReferences?.Moc
  if (typeof mocName !== 'string' || mocName.trim().length === 0) {
    return
  }
  const mocRelative = join(dirname(model3Relative), mocName).replace(/\\/gu, '/')
  if (mocRelative.split('/').includes('..')) {
    throw new ModelUploadError('moc3 path must stay inside the model directory')
  }
  let bytes: Uint8Array
  try {
    bytes = await readFile(join(staging, mocRelative))
  } catch {
    return
  }
  const version = readMoc3Version(bytes)
  if (version !== undefined && moc3ExceedsRuntime(version, RUNTIME_MAX_MOC_VERSION)) {
    throw new ModelUploadError(formatMocVersionError(version, RUNTIME_MAX_MOC_VERSION))
  }
}

async function flattenSingleRoot(staging: string): Promise<void> {
  const entries = (await readdir(staging, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith('.'))
  if (entries.length !== 1 || entries[0]?.isDirectory() !== true) return
  const only = entries[0].name
  const nested = join(staging, only)
  const inner = await readdir(nested)
  const holding = join(staging, `.flatten-${process.pid}`)
  await rename(nested, holding)
  for (const name of inner) {
    await rename(join(holding, name), join(staging, name))
  }
  await rm(holding, { recursive: true, force: true })
}

async function findModel3Relative(root: string): Promise<string | undefined> {
  const files = await walkFiles(root)
  const match = files.find((file) => {
    const posix = file.replace(/\\/gu, '/')
    return posix.endsWith('.model3.json') && !posix.includes('__MACOSX/')
  })
  return match
}

async function walkFiles(root: string, prefix = ''): Promise<string[]> {
  let entries
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      out.push(...await walkFiles(root, relative))
      continue
    }
    if (entry.isFile()) out.push(relative)
  }
  return out
}

async function directoryBytes(root: string): Promise<number> {
  const files = await walkFiles(root)
  let total = 0
  for (const file of files) {
    const data = await readFile(join(root, file))
    total += data.byteLength
  }
  return total
}

function inferNameFromPath(model3Relative: string): string {
  const parts = model3Relative.replace(/\\/gu, '/').split('/')
  const folder = parts.length > 1 ? parts[0] : parts[0]?.replace(/\.model3\.json$/u, '')
  return sanitizeModelName(folder ?? 'model')
}

async function readCatalogFile(dataRoot: string): Promise<string> {
  try {
    const raw = await readFile(join(dataRoot, CATALOG_FILE), 'utf8')
    const parsed = JSON.parse(raw) as { current?: unknown }
    return typeof parsed.current === 'string' && parsed.current.length > 0
      ? parsed.current
      : BUILTIN_HIYORI_NAME
  } catch {
    return BUILTIN_HIYORI_NAME
  }
}

async function writeCatalogFile(dataRoot: string, current: string): Promise<void> {
  const path = join(dataRoot, CATALOG_FILE)
  await mkdir(dirname(path), { recursive: true })
  const pending = `${path}.${process.pid}.tmp`
  await writeFile(pending, `${JSON.stringify({ current }, null, 2)}\n`, 'utf8')
  await rename(pending, path)
}

async function movePath(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EXDEV') throw error
    const { cp } = await import('node:fs/promises')
    await cp(src, dest, { recursive: true })
    await rm(src, { recursive: true, force: true })
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
