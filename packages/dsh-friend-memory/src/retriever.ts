import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import {
  dailyDir,
  memoryFilePath,
  storyFilePath,
  userFilePath,
} from './paths.ts'
import { MemoryPathError, resolveMemoryPath, toDataRel } from './whitelist.ts'

export const SEARCH_HIT_LIMIT = 20
export const SEARCH_CONTEXT_LINES = 2

export type MemoryHit = {
  path: string
  line: number
  snippet: string
  score: number
}

export type LineRange = {
  from?: number
  to?: number
}

export type BootstrapBundle = {
  memory: string
  today: string
  yesterday: string
  user: string
}

export interface MemoryRetriever {
  search(query: string): Promise<MemoryHit[]>
  get(path: string, range?: LineRange): Promise<string>
  bootstrap(): Promise<BootstrapBundle>
}

export type RetrieverRoots = {
  dataDir: string
  slug: string
  today: string
  yesterday: string
}

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; shell?: boolean },
) => ChildProcessWithoutNullStreams

export type RgRetrieverOptions = RetrieverRoots & {
  spawn?: SpawnLike
  rgCommand?: string
  /** Test seam: skip the subprocess and use the in-process scanner. */
  useProcess?: boolean
}

/**
 * Default retriever. ripgrep is invoked with a fixed argv and `shell: false`.
 * The query is never interpolated into a shell string. When `rg` is missing,
 * search falls back to the same in-process scanner the contract suite uses.
 */
export class RgRetriever implements MemoryRetriever {
  private readonly roots: RetrieverRoots
  private readonly spawnFn: SpawnLike
  private readonly rgCommand: string
  private readonly useProcess: boolean

  constructor(options: RgRetrieverOptions) {
    this.roots = options
    this.spawnFn = options.spawn ?? spawn
    this.rgCommand = options.rgCommand ?? 'rg'
    this.useProcess = options.useProcess ?? true
  }

  async search(query: string): Promise<MemoryHit[]> {
    if (query.trim().length === 0) {
      return []
    }
    const files = await listSearchFiles(this.roots)
    if (files.length === 0) {
      return []
    }
    if (this.useProcess) {
      try {
        return await searchWithRipgrep({
          spawnFn: this.spawnFn,
          command: this.rgCommand,
          cwd: this.roots.dataDir,
          query,
          files,
        })
      } catch (error) {
        if (!isRgUnavailable(error)) {
          throw error
        }
      }
    }
    return searchInProcess(this.roots.dataDir, files, query)
  }

  async get(path: string, range?: LineRange): Promise<string> {
    const absolute = resolveMemoryPath(this.roots.dataDir, path)
    const raw = await readFile(absolute, 'utf8')
    return sliceLines(raw, range)
  }

  async bootstrap(): Promise<BootstrapBundle> {
    return readBootstrap(this.roots)
  }
}

export function createRgRetriever(options: RgRetrieverOptions): RgRetriever {
  return new RgRetriever(options)
}

/** In-process implementation of the same contract (no subprocess). */
export class FileRetriever implements MemoryRetriever {
  private readonly roots: RetrieverRoots

  constructor(roots: RetrieverRoots) {
    this.roots = roots
  }

  async search(query: string): Promise<MemoryHit[]> {
    if (query.trim().length === 0) {
      return []
    }
    const files = await listSearchFiles(this.roots)
    return searchInProcess(this.roots.dataDir, files, query)
  }

  async get(path: string, range?: LineRange): Promise<string> {
    const absolute = resolveMemoryPath(this.roots.dataDir, path)
    return sliceLines(await readFile(absolute, 'utf8'), range)
  }

  async bootstrap(): Promise<BootstrapBundle> {
    return readBootstrap(this.roots)
  }
}

export async function readBootstrap(roots: RetrieverRoots): Promise<BootstrapBundle> {
  const slug = roots.slug
  const [memory, today, yesterday, user] = await Promise.all([
    readOptional(memoryFilePath(roots.dataDir, slug)),
    readDailyAnywhere(roots.dataDir, slug, roots.today),
    readDailyAnywhere(roots.dataDir, slug, roots.yesterday),
    readOptional(userFilePath(roots.dataDir)),
  ])
  return { memory, today, yesterday, user }
}

/** Disk read on every assemble — no cached MEMORY.md / notes. */
export function readBootstrapSync(roots: RetrieverRoots): BootstrapBundle {
  const slug = roots.slug
  return {
    memory: readOptionalSync(memoryFilePath(roots.dataDir, slug)),
    today: readDailyAnywhereSync(roots.dataDir, slug, roots.today),
    yesterday: readDailyAnywhereSync(roots.dataDir, slug, roots.yesterday),
    user: readOptionalSync(userFilePath(roots.dataDir)),
  }
}

export function sliceLines(raw: string, range?: LineRange): string {
  const lines = raw.split(/\r?\n/u)
  if (range === undefined) {
    return raw
  }
  const from = Math.max(1, range.from ?? 1)
  const to = Math.min(lines.length, range.to ?? lines.length)
  if (from > to) {
    return ''
  }
  return lines.slice(from - 1, to).join('\n')
}

export function buildRgArgs(query: string, files: readonly string[]): string[] {
  return [
    '-n',
    '-F',
    '-C',
    String(SEARCH_CONTEXT_LINES),
    '--color',
    'never',
    '--no-heading',
    '--',
    query,
    ...files,
  ]
}

export async function searchWithRipgrep(options: {
  spawnFn: SpawnLike
  command: string
  cwd: string
  query: string
  files: readonly string[]
}): Promise<MemoryHit[]> {
  const args = buildRgArgs(options.query, options.files)
  const { stdout, stderr, code } = await runChild(
    options.spawnFn,
    options.command,
    args,
    options.cwd,
  )
  if (code === 1 && stdout.trim().length === 0) {
    return []
  }
  if (code !== 0 && code !== 1) {
    throw new Error(`dsh-friend-memory: rg exited ${code}: ${stderr}`)
  }
  return rankHits(parseRgOutput(options.cwd, stdout, options.query), options.query)
}

export function parseRgOutput(dataDir: string, stdout: string, query: string): MemoryHit[] {
  const groups = new Map<string, { path: string; line: number; lines: string[] }>()
  let current: { path: string; line: number; key: string } | undefined

  for (const rawLine of stdout.split(/\r?\n/u)) {
    if (rawLine.length === 0) {
      current = undefined
      continue
    }
    const match = /^(.*?)[-:](\d+)[-:](.*)$/u.exec(rawLine)
    if (match === null) {
      continue
    }
    const file = match[1]
    const lineText = match[2]
    const body = match[3]
    if (file === undefined || lineText === undefined || body === undefined) {
      continue
    }
    const line = Number(lineText)
    const path = toDataRel(dataDir, join(dataDir, file))
    const isMatch = rawLine.slice(file.length, file.length + 1) === ':'
    if (isMatch) {
      const key = `${path}:${line}`
      current = { path, line, key }
      const group = groups.get(key) ?? { path, line, lines: [] }
      group.lines.push(body)
      groups.set(key, group)
      continue
    }
    if (current !== undefined) {
      groups.get(current.key)?.lines.push(body)
    }
  }

  return [...groups.values()].map((group) => ({
    path: group.path,
    line: group.line,
    snippet: group.lines.join('\n'),
    score: countOccurrences(group.lines.join('\n'), query),
  }))
}

export async function searchInProcess(
  dataDir: string,
  files: readonly string[],
  query: string,
): Promise<MemoryHit[]> {
  const hits: MemoryHit[] = []
  for (const file of files) {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const lines = raw.split(/\r?\n/u)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      if (!line.includes(query)) {
        continue
      }
      const from = Math.max(0, index - SEARCH_CONTEXT_LINES)
      const to = Math.min(lines.length, index + SEARCH_CONTEXT_LINES + 1)
      const snippet = lines.slice(from, to).join('\n')
      hits.push({
        path: toDataRel(dataDir, file),
        line: index + 1,
        snippet,
        score: countOccurrences(line, query),
      })
    }
  }
  return rankHits(hits, query)
}

export function rankHits(hits: readonly MemoryHit[], query: string): MemoryHit[] {
  const scored = hits.map((hit) => ({
    ...hit,
    score: hit.score > 0 ? hit.score : countOccurrences(hit.snippet, query),
  }))
  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }
    if (left.path !== right.path) {
      return left.path.localeCompare(right.path, 'en')
    }
    return left.line - right.line
  })
  return scored.slice(0, SEARCH_HIT_LIMIT)
}

export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0
  }
  let count = 0
  let from = 0
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from)
    if (index < 0) {
      break
    }
    count += 1
    from = index + needle.length
  }
  return count
}

export async function listSearchFiles(roots: RetrieverRoots): Promise<string[]> {
  const slug = roots.slug
  const files: string[] = []
  await pushIfFile(files, memoryFilePath(roots.dataDir, slug))
  await pushIfFile(files, storyFilePath(roots.dataDir, slug))
  await walkMarkdown(files, dailyDir(roots.dataDir, slug))
  return files
}

function dailyCandidates(dataDir: string, slug: string, date: string): string[] {
  return [
    join(dailyDir(dataDir, slug), `${date}.md`),
    join(dailyDir(dataDir, slug), 'archive', date.slice(0, 7), `${date}.md`),
    join(dailyDir(dataDir, slug), 'imported', `${date}.md`),
  ]
}

async function readDailyAnywhere(dataDir: string, slug: string, date: string): Promise<string> {
  for (const candidate of dailyCandidates(dataDir, slug, date)) {
    const text = await readOptional(candidate)
    if (text.length > 0) {
      return text
    }
  }
  return ''
}

function readDailyAnywhereSync(dataDir: string, slug: string, date: string): string {
  for (const candidate of dailyCandidates(dataDir, slug, date)) {
    const text = readOptionalSync(candidate)
    if (text.length > 0) {
      return text
    }
  }
  return ''
}

async function walkMarkdown(files: string[], root: string): Promise<void> {
  if (!await isDirectory(root)) {
    return
  }
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) {
      break
    }
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(full)
      }
    }
  }
}

async function pushIfFile(files: string[], path: string): Promise<void> {
  try {
    const info = await stat(path)
    if (info.isFile()) {
      files.push(path)
    }
  } catch {
    // missing is fine
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

function readOptionalSync(path: string): string {
  if (!existsSync(path)) {
    return ''
  }
  return readFileSync(path, 'utf8')
}

function runChild(
  spawnFn: SpawnLike,
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawnFn(command, [...args], { cwd, shell: false })
    } catch (error) {
      reject(error)
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      reject(error)
    })
    child.on('close', (code) => {
      resolve({ stdout, stderr, code })
    })
  })
}

function isRgUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false
  }
  const code = (error as { code: unknown }).code
  return code === 'ENOENT'
}

export { MemoryPathError, resolveMemoryPath, relative as pathRelative, sep as pathSep }
