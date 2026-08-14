import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts/dsh-plugin-new.mjs')

async function run(args: string[]) {
  return execFileAsync(process.execPath, [SCRIPT, ...args], { cwd: ROOT })
}

describe('dsh-plugin-new', () => {
  it('prints the skeleton list and writes nothing under --dry-run', async () => {
    const { stdout } = await run(['foo', '--dry-run'])

    expect(stdout).toContain('packages/dsh-friend-foo/package.json')
    expect(stdout).toContain('packages/dsh-friend-foo/tsconfig.json')
    expect(stdout).toContain('packages/dsh-friend-foo/tsdown.config.ts')
    expect(stdout).toContain('packages/dsh-friend-foo/src/index.ts')
    expect(stdout).toContain('packages/dsh-friend-foo/src/client.ts')
    expect(stdout).toContain('packages/dsh-friend-foo/README.md')
    expect(stdout).not.toContain('packages/dsh-friend-foo/cordis.patch.yml')
    expect(existsSync(join(ROOT, 'packages/dsh-friend-foo'))).toBe(false)
  })

  it('host template calls the shared mount helper', async () => {
    const source = await readFile(SCRIPT, 'utf8')
    expect(source).toContain("import { logPluginMount } from '@wish233/dsh-friend-shared'")
    expect(source).toContain('logPluginMount(name)')
  })

  it('omits the client half when --no-client --dry-run', async () => {
    const { stdout } = await run(['foo', '--no-client', '--dry-run'])

    expect(stdout).toContain('packages/dsh-friend-foo/src/index.ts')
    expect(stdout).not.toContain('packages/dsh-friend-foo/src/client.ts')
    expect(existsSync(join(ROOT, 'packages/dsh-friend-foo'))).toBe(false)
  })
})
