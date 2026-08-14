import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

type Manifest = {
  dsh?: {
    bundle?: {
      patch?: string
    }
  }
}

async function readBundle(): Promise<{ manifest: Manifest; patch: string } | undefined> {
  try {
    const root = new URL('../', import.meta.url)
    const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8')) as Manifest
    const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
    return { manifest, patch }
  } catch {
    return undefined
  }
}

describe('aggregate bundle contract', () => {
  it('mounts the stage package through the official DSH bundle patch', async () => {
    const bundle = await readBundle()

    expect(bundle, 'aggregate bundle files must exist').toBeDefined()
    expect(bundle?.manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(bundle?.patch).toContain('@wish233/dsh-friend-stage')
  })
})
