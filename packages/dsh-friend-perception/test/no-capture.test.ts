import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = new URL('../src', import.meta.url)
const FORBIDDEN = [
  /getDisplayMedia\s*\(/,
  /getUserMedia\s*\(/,
  /desktopCapturer/,
  /mediaDevices/,
  /html2canvas/,
  /navigator\.mediaDevices/,
]

async function listTs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listTs(path))
    } else if (entry.name.endsWith('.ts')) {
      files.push(path)
    }
  }
  return files
}

describe('v1 perception source has no capture path', () => {
  it('does not call screen or camera APIs', async () => {
    const files = await listTs(SRC.pathname)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      for (const pattern of FORBIDDEN) {
        expect(source, `${file} matched ${pattern}`).not.toMatch(pattern)
      }
    }
  })
})
