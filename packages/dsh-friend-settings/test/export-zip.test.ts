import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildZipStore, isExcludedExportPath, listExportEntries, zipEntryNames } from '../src/export-zip.ts'

describe('data export zip', () => {
  it('includes memory/characters/story and excludes cache/vendor', async () => {
    const root = join(tmpdir(), `dsh-friend-settings-export-${Date.now()}`)
    await mkdir(join(root, 'characters', 'default'), { recursive: true })
    await mkdir(join(root, 'user'), { recursive: true })
    await mkdir(join(root, 'cache', 'tts'), { recursive: true })
    await mkdir(join(root, 'vendor', 'hiyori'), { recursive: true })
    await writeFile(join(root, 'characters', 'default', 'persona.json'), '{"name":"小友"}')
    await writeFile(join(root, 'characters', 'default', 'MEMORY.md'), '不吃香菜')
    await writeFile(join(root, 'characters', 'default', 'story.md'), '第一章')
    await writeFile(join(root, 'user', 'USER.md'), '用户')
    await writeFile(join(root, 'cache', 'tts', 'x.bin'), 'secret-cache')
    await writeFile(join(root, 'vendor', 'hiyori', 'NOTICE.md'), 'notice')

    expect(isExcludedExportPath('cache/tts/x.bin')).toBe(true)
    expect(isExcludedExportPath('vendor/hiyori/NOTICE.md')).toBe(true)
    expect(isExcludedExportPath('characters/default/MEMORY.md')).toBe(false)

    const entries = await listExportEntries(root)
    const names = entries.map((entry) => entry.name)
    expect(names).toContain('characters/default/persona.json')
    expect(names).toContain('characters/default/MEMORY.md')
    expect(names).toContain('characters/default/story.md')
    expect(names).toContain('user/USER.md')
    expect(names.some((name) => name.startsWith('cache/'))).toBe(false)
    expect(names.some((name) => name.startsWith('vendor/'))).toBe(false)

    const zip = buildZipStore(entries)
    const zipped = zipEntryNames(zip)
    expect(zipped).toEqual(names)
    expect(zipped.join('\n')).not.toContain('secret-cache')
  })
})
