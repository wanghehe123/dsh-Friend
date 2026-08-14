import { EventEmitter } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import {
  buildRgArgs,
  FileRetriever,
  RgRetriever,
  SEARCH_HIT_LIMIT,
  type SpawnLike,
} from '../src/retriever.ts'
import { MemoryStore } from '../src/store.ts'
import { tempDataDir } from './helpers/tmp.ts'

async function seededRoots(dataDir: string) {
  const store = new MemoryStore({
    dataDir,
    slug: 'default',
    now: () => new Date('2026-08-14T12:00:00'),
  })
  await store.appendDaily({
    text: '8 月 3 日是用户生日',
    source: 'note',
    date: '2026-08-11',
  })
  await store.appendDaily({
    text: 'user likes tea',
    source: 'note',
    date: '2026-08-12',
  })
  await mkdir(join(dataDir, 'characters/default'), { recursive: true })
  await writeFile(join(dataDir, 'characters/default/story.md'), '小时候在海边\n', 'utf8')
  return {
    dataDir,
    slug: 'default',
    today: '2026-08-14',
    yesterday: '2026-08-13',
  }
}

function runContract(factory: (roots: Awaited<ReturnType<typeof seededRoots>>) => FileRetriever | RgRetriever) {
  describe('MemoryRetriever contract', () => {
    it('recalls 生日 from a note three days ago', async () => {
      const roots = await seededRoots(await tempDataDir())
      const hits = await factory(roots).search('生日')
      expect(hits.length).toBeGreaterThan(0)
      const hit = hits[0]
      expect(hit?.snippet).toContain('8 月 3 日')
      expect(hit?.path).toContain('2026-08-11.md')
      expect(hit?.line).toBeGreaterThan(0)
    })

    it('recalls an English keyword and ranks multi-file hits', async () => {
      const roots = await seededRoots(await tempDataDir())
      await writeFile(join(roots.dataDir, 'characters/default/MEMORY.md'), '## 重要事实\n\n- tea every morning\n- tea at night\n', 'utf8')
      const hits = await factory(roots).search('tea')
      expect(hits.length).toBeGreaterThanOrEqual(2)
      expect(hits[0]?.score).toBeGreaterThanOrEqual(hits[1]?.score ?? 0)
      expect(hits.some((hit) => hit.path.endsWith('MEMORY.md'))).toBe(true)
      expect(hits.some((hit) => hit.path.includes('2026-08-12.md'))).toBe(true)
    })

    it('treats regex metacharacters as literals and returns [] when nothing matches', async () => {
      const roots = await seededRoots(await tempDataDir())
      const retriever = factory(roots)
      await expect(retriever.search('.*')).resolves.toEqual([])
      await expect(retriever.search('不存在的词')).resolves.toEqual([])
    })

    it('caps results at 20', async () => {
      const roots = await seededRoots(await tempDataDir())
      const lines = Array.from({ length: 30 }, (_, index) => `- hit ${index} 生日`).join('\n')
      await writeFile(join(roots.dataDir, 'characters/default/MEMORY.md'), `## 重要事实\n\n${lines}\n`, 'utf8')
      const hits = await factory(roots).search('生日')
      expect(hits.length).toBeLessThanOrEqual(SEARCH_HIT_LIMIT)
    })
  })
}

runContract((roots) => new FileRetriever(roots))

describe('RgRetriever spawn contract', () => {
  it('passes the query as a fixed argv element with shell:false', async () => {
    const roots = await seededRoots(await tempDataDir())
    const query = '"; rm -rf ~'
    const spawned: Array<{ command: string; args: readonly string[]; shell?: boolean }> = []
    const spawnFn: SpawnLike = (command, args, options) => {
      spawned.push({ command, args, shell: options.shell })
      const stdout = new Readable({ read() { this.push(null) } })
      const stderr = new Readable({ read() { this.push(null) } })
      const child = new EventEmitter() as ReturnType<SpawnLike>
      child.stdout = stdout
      child.stderr = stderr
      stdout.setEncoding('utf8')
      stderr.setEncoding('utf8')
      queueMicrotask(() => child.emit('close', 1))
      return child
    }

    const retriever = new RgRetriever({ ...roots, spawn: spawnFn, useProcess: true })
    await expect(retriever.search(query)).resolves.toEqual([])

    expect(spawned).toHaveLength(1)
    expect(spawned[0]?.shell).toBe(false)
    const args = spawned[0]?.args ?? []
    expect(args[args.indexOf('--') + 1]).toBe(query)
    expect(args).toContain('-F')
    expect(args.some((part) => part.includes('sh -c'))).toBe(false)
  })

  it('buildRgArgs never interpolates the query into a shell string', () => {
    const query = '"; rm -rf ~ && echo pwned'
    const args = buildRgArgs(query, ['MEMORY.md'])
    expect(args[args.indexOf('--') + 1]).toBe(query)
    expect(args).toContain('-F')
    expect(args).toContain('MEMORY.md')
    expect(args.filter((part) => part === query)).toHaveLength(1)
  })
})
