import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { checkPixiLive2d } from '../../../scripts/check-pixi-live2d.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('pixi-live2d-display unpack guard', () => {
  it('fails the suite when the npm package is an empty shell', async () => {
    const result = await checkPixiLive2d({ root: ROOT })
    expect(result.ok, result.message).toBe(true)
  })
})
