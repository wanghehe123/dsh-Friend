import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assertReadableFile,
  formatReport,
  parseArgs,
  resolveKokoroFrom,
  runImportKokoro,
  usage,
} from './import-kokoro.mjs'

async function tempDir(prefix = 'dsh-friend-import-kokoro-') {
  const dir = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(dir, { recursive: true })
  return dir
}

describe('parseArgs', () => {
  it('reads --from and --to', () => {
    expect(parseArgs(['--from', '/tmp/kokoro', '--to', '/tmp/friend'])).toEqual({
      help: false,
      from: '/tmp/kokoro',
      to: '/tmp/friend',
    })
  })

  it('parses --help', () => {
    expect(parseArgs(['--help'])).toMatchObject({ help: true })
  })

  it('rejects a missing --from value', () => {
    expect(() => parseArgs(['--from'])).toThrow('--from requires a path')
  })
})

describe('resolveKokoroFrom / assertReadableFile', () => {
  it('treats a kokoro.db file as the source database', async () => {
    const dir = await tempDir()
    const dbPath = join(dir, 'kokoro.db')
    await writeFile(dbPath, 'fixture', 'utf8')
    await expect(resolveKokoroFrom(dbPath)).resolves.toEqual({
      fromDir: dir,
      dbPath,
    })
  })

  it('treats a data directory as the folder that must contain kokoro.db', async () => {
    const dir = await tempDir()
    await expect(resolveKokoroFrom(dir)).resolves.toEqual({
      fromDir: dir,
      dbPath: join(dir, 'kokoro.db'),
    })
  })

  it('rejects a missing path and a non-kokoro.db file', async () => {
    const dir = await tempDir()
    const other = join(dir, 'notes.txt')
    await writeFile(other, 'nope', 'utf8')
    await expect(resolveKokoroFrom(join(dir, 'missing'))).rejects.toThrow(/source not found/)
    await expect(resolveKokoroFrom(other)).rejects.toThrow(/expected kokoro.db/)
  })

  it('explains when kokoro.db is absent', async () => {
    const dir = await tempDir()
    await expect(assertReadableFile(join(dir, 'kokoro.db'))).rejects.toThrow(/kokoro.db not found/)
  })
})

describe('runImportKokoro', () => {
  it('prints usage and exits 2 when flags are missing', async () => {
    const errors: string[] = []
    const code = await runImportKokoro({
      argv: [],
      log() {},
      error(line) {
        errors.push(String(line))
      },
    })
    expect(code).toBe(2)
    expect(errors.join('\n')).toContain(usage())
  })

  it('exits 1 with a reason when the source db is missing', async () => {
    const fromDir = await tempDir()
    const toDir = await tempDir('dsh-friend-import-to-')
    const errors: string[] = []
    const code = await runImportKokoro({
      argv: ['--from', fromDir, '--to', toDir],
      log() {},
      error(line) {
        errors.push(String(line))
      },
    })
    expect(code).toBe(1)
    expect(errors.join('\n')).toMatch(/kokoro.db not found/)
  })

  it('calls the importer and prints the migration report', async () => {
    const fromDir = await tempDir()
    const toDir = await tempDir('dsh-friend-import-to-')
    await writeFile(join(fromDir, 'kokoro.db'), 'fixture', 'utf8')
    const report = {
      memories: 2,
      highlights: 1,
      characters: 1,
      growthEpisodes: 0,
      growthBeliefs: 0,
      userProfile: false,
      live2dCopied: 0,
      petConfigMapped: false,
      skipped: [{ item: 'growth:draft', reason: 'draft' }],
      sourceMtimeMs: 1,
    }
    const logs: string[] = []
    let seen: { fromDir: string; dataDir: string } | undefined
    const code = await runImportKokoro({
      argv: ['--from', fromDir, '--to', toDir],
      importKokoro: async (options) => {
        seen = options
        return report
      },
      log(line) {
        logs.push(String(line))
      },
      error() {},
    })
    expect(code).toBe(0)
    expect(seen).toEqual({ fromDir, dataDir: toDir })
    expect(logs.join('\n')).toBe(formatReport(report))
    expect(logs.join('\n')).toContain('"memories": 2')
  })
})
