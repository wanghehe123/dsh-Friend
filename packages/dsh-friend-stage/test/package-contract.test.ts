import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

type Manifest = {
  dsh?: {
    client?: {
      platform?: string
      inject?: string[]
    }
  }
  exports?: Record<string, { default?: string; types?: string } | string>
  files?: string[]
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

async function readManifest(): Promise<Manifest | undefined> {
  try {
    const path = new URL('../package.json', import.meta.url)
    return JSON.parse(await readFile(path, 'utf8')) as Manifest
  } catch {
    return undefined
  }
}

describe('stage package contract', () => {
  it('declares a DSH web client half and its built client entry', async () => {
    const manifest = await readManifest()

    expect(manifest, 'stage package manifest must be readable').toBeDefined()
    expect(manifest?.dsh?.client).toEqual({
      platform: 'web',
      inject: ['settingsScope'],
    })
    expect(manifest?.exports?.['./client']).toEqual({
      types: './lib/client.d.ts',
      default: './lib/client.js',
    })
    expect(manifest?.exports?.['./pet']).toEqual({
      default: './lib/pet.iife.js',
    })
    expect(manifest?.exports?.['./tags']).toEqual({
      types: './lib/tags.d.ts',
      default: './lib/tags.js',
    })
  })

  it('keeps pixi as a build-only dependency and ships third-party notices', async () => {
    const manifest = await readManifest()

    expect(manifest?.files).toContain('THIRD-PARTY-NOTICES.md')
    expect(manifest?.dependencies).not.toHaveProperty('pixi.js')
    expect(manifest?.dependencies).not.toHaveProperty('pixi-live2d-display')
    expect(manifest?.devDependencies?.['pixi.js']).toBe('6.5.10')
    expect(manifest?.devDependencies?.['pixi-live2d-display']).toBe('0.4.0')
    expect(manifest?.dependencies?.['@wishp3/dsh-friend-asr']).toBe('workspace:*')
    expect(manifest?.dependencies?.fflate).toBe('0.8.3')
    expect(manifest?.files).toContain('vendor-integrity.json')
  })

  it('exports a scoped plugin id matching the npm package name', async () => {
    const stage = await import('../src/index.ts')
    expect(stage.name).toBe('@wishp3/dsh-friend-stage')
  })
})
