import { describe, expect, it } from 'vitest'

import { parseArgs, usage } from './publish-npm.mjs'

describe('publish-npm args', () => {
  it('parses dry-run and help flags', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, help: false })
    expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true, help: false })
    expect(parseArgs(['--help'])).toEqual({ dryRun: false, help: true })
    expect(parseArgs(['-h', '--dry-run'])).toEqual({ dryRun: true, help: true })
  })

  it('documents the local release path', () => {
    expect(usage()).toContain('--dry-run')
    expect(usage()).toContain('CI=true')
  })
})
