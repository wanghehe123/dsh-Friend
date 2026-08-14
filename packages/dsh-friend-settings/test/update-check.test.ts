import { describe, expect, it } from 'vitest'

import { FRIEND_GITHUB_RELEASES_API, FRIEND_GITHUB_REPO } from '../src/github-repo.ts'
import { checkForUpdate, DEFAULT_RELEASES_URL } from '../src/update-check.ts'

describe('update check', () => {
  it('reports latest / available / failed from a mock releases API', async () => {
    const latest = await checkForUpdate({
      current: '0.1.0',
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return { tag_name: 'v0.1.0' }
        },
      }),
    })
    expect(latest.status).toBe('latest')
    expect(latest.latest).toBe('v0.1.0')

    const available = await checkForUpdate({
      current: '0.1.0',
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return { tag_name: 'v0.2.0' }
        },
      }),
    })
    expect(available.status).toBe('available')
    expect(available.latest).toBe('v0.2.0')

    const failed = await checkForUpdate({
      current: '0.1.0',
      fetchImpl: async () => {
        throw new Error('network down')
      },
    })
    expect(failed.status).toBe('failed')
    expect(failed.detail).toContain('network down')
  })

  it('builds the releases API URL from the single placeholder repo constant', () => {
    expect(DEFAULT_RELEASES_URL).toBe(FRIEND_GITHUB_RELEASES_API)
    expect(DEFAULT_RELEASES_URL).toBe(`https://api.github.com/repos/${FRIEND_GITHUB_REPO}/releases/latest`)
  })
})
