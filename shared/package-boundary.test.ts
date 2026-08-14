/**
 * Repo-level package boundary: packages/<pkg>/src and packages/<pkg>/test
 * must not relative-import another packages/<pkg> tree.
 *
 * Feature client halves cannot import `@wish233/dsh-friend-shared` (host,
 * Node builtins) or `@wish233/dsh-friend-shared/client` (ModuleLoader
 * payload). Platform-neutral constants live at
 * `@wish233/dsh-friend-shared/universal`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES_DIR = join(ROOT, 'packages')

const SOURCE_FOLDERS = ['src', 'test'] as const
const SPECIFIER_RE = /(?:\bfrom\s+|import\s*\(\s*)['"]([^'"]+)['"]/g

type Violation = {
  file: string
  specifier: string
  targetPackage: string
}

function posixRel(from: string, to: string): string {
  return relative(from, to).split(sep).join('/')
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

function packageDirOf(filePath: string): string | undefined {
  const rel = relative(PACKAGES_DIR, filePath)
  if (rel.startsWith('..') || rel === '') return undefined
  const [pkg] = rel.split(sep)
  return pkg
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function specifiersOf(source: string): string[] {
  const found: string[] = []
  SPECIFIER_RE.lastIndex = 0
  for (const match of stripComments(source).matchAll(SPECIFIER_RE)) {
    const spec = match[1]
    if (spec !== undefined) found.push(spec)
  }
  return found
}

async function walkTsFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (isErrno(error) && error.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name.endsWith('.d.ts')) continue
      if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        out.push(full)
      }
    }
  }
  await walk(root)
  return out
}

function formatViolation(item: Violation): string {
  return [
    `${item.file} imports '${item.specifier}'`,
    `  which resolves into packages/${item.targetPackage}/.`,
    `  Use a package-name subpath instead of a cross-package relative path.`,
    `  Platform-neutral shared constants: '@wish233/dsh-friend-shared/universal'.`,
    `  Do not import '@wish233/dsh-friend-shared' from a client half (Node builtins)`,
    `  or '@wish233/dsh-friend-shared/client' from Node / tests (ModuleLoader payload).`,
  ].join('\n')
}

describe('package import boundaries', () => {
  it('forbids relative imports that escape into another packages/<pkg>/', async () => {
    const violations: Violation[] = []
    const pkgEntries = await readdir(PACKAGES_DIR, { withFileTypes: true })
    for (const pkg of pkgEntries) {
      if (!pkg.isDirectory()) continue
      for (const folder of SOURCE_FOLDERS) {
        const files = await walkTsFiles(join(PACKAGES_DIR, pkg.name, folder))
        for (const file of files) {
          const fromPackage = packageDirOf(file)
          if (fromPackage === undefined) continue
          const source = await readFile(file, 'utf8')
          for (const specifier of specifiersOf(source)) {
            if (!specifier.includes('../../')) continue
            const resolved = resolve(dirname(file), specifier)
            const targetPackage = packageDirOf(resolved)
            if (targetPackage === undefined || targetPackage === fromPackage) continue
            violations.push({
              file: posixRel(ROOT, file),
              specifier,
              targetPackage,
            })
          }
        }
      }
    }

    expect(violations, violations.map(formatViolation).join('\n\n')).toEqual([])
  })
})
