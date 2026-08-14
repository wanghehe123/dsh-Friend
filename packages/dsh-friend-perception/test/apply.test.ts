import { describe, expect, it, vi } from 'vitest'

import { apply, applyPerception, getFriendPerception, name } from '../src/index.ts'

describe('perception host apply', () => {
  it('mounts without inject and reports unavailable', async () => {
    expect(name).toBe('@wish233/dsh-friend-perception')
    expect(Object.hasOwn(await import('../src/index.ts'), 'inject')).toBe(false)

    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const handle = applyPerception()
    expect(info).toHaveBeenCalledWith('dsh-friend:plugin-mount @wish233/dsh-friend-perception')
    expect(handle.perception.capabilities().available).toBe(false)
    await expect(handle.perception.captureContext()).resolves.toMatchObject({
      contentType: 'unavailable',
      source: 'none',
    })
    expect(getFriendPerception().capabilities().available).toBe(false)
    apply()
    handle.dispose()
    info.mockRestore()
  })
})
