import { describe, expect, it } from 'vitest'

import {
  createFriendPerception,
  createUnavailablePerceptionProvider,
  UNAVAILABLE_PERCEPTION_ID,
  UNAVAILABLE_PERCEPTION_REASON,
  type PerceptionFrame,
  type PerceptionProvider,
} from '../src/seam.ts'

describe('perception seam reports unavailable without throwing', () => {
  it('capabilities() is unavailable and captureContext() resolves an empty frame', async () => {
    const provider = createUnavailablePerceptionProvider()
    expect(() => provider.capabilities()).not.toThrow()
    const caps = provider.capabilities()
    expect(caps.available).toBe(false)
    expect(caps.screen).toBe(false)
    expect(caps.camera).toBe(false)
    expect(caps.reason).toBe(UNAVAILABLE_PERCEPTION_REASON)
    expect(provider.id).toBe(UNAVAILABLE_PERCEPTION_ID)

    let frame: PerceptionFrame | undefined
    await expect(provider.captureContext().then((value) => {
      frame = value
    })).resolves.toBeUndefined()
    expect(frame).toMatchObject({
      source: 'none',
      contentType: 'unavailable',
    })
    expect(frame?.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(frame).not.toHaveProperty('bytes')
    expect(JSON.stringify(frame)).not.toMatch(/data:image|base64/)
  })

  it('the facade stays unavailable even if a future provider is only registered as a stub', async () => {
    const perception = createFriendPerception()
    expect(() => perception.capabilities()).not.toThrow()
    expect(perception.capabilities().available).toBe(false)
    const frame = await perception.captureContext()
    expect(frame.contentType).toBe('unavailable')
    expect(frame).not.toHaveProperty('bytes')
  })

  it('registry is the extension point: an available provider can take over later', async () => {
    const perception = createFriendPerception()
    const future: PerceptionProvider = {
      id: 'future-multimodal',
      capabilities() {
        return {
          available: true,
          screen: true,
          camera: false,
          reason: 'test-only',
          reasonCode: 'ready',
        }
      },
      async captureContext() {
        return {
          source: 'file',
          capturedAt: '2026-08-14T00:00:00.000Z',
          contentType: 'text/plain',
        }
      },
    }
    const dispose = perception.register(future)
    expect(perception.capabilities().available).toBe(true)
    expect((await perception.captureContext()).source).toBe('file')
    dispose()
    expect(perception.capabilities().available).toBe(false)
    expect((await perception.captureContext()).contentType).toBe('unavailable')
  })
})
