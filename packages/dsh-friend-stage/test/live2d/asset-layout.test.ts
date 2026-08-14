import { describe, expect, it } from 'vitest'

import {
  HIYORI_MODEL_RELATIVE_PATH,
  LIVE2D_CORE_RELATIVE_PATH,
  resolveFriendAssetPath,
} from '../../src/live2d/asset-layout.ts'

describe('Live2D vendor asset layout', () => {
  it('keeps official assets outside the plugin bundle in a deterministic user-data layout', () => {
    expect(HIYORI_MODEL_RELATIVE_PATH).toBe(
      'vendor/hiyori/hiyori_free/runtime/hiyori_free_t08.model3.json',
    )
    expect(LIVE2D_CORE_RELATIVE_PATH).toBe('vendor/cubism-core/live2dcubismcore.min.js')
  })

  it('resolves a normal nested asset but rejects path traversal and absolute paths', () => {
    expect(resolveFriendAssetPath('/tmp/dsh-friend', 'vendor/hiyori/hiyori_free/runtime/hiyori_free_t08.moc3'))
      .toBe('/tmp/dsh-friend/vendor/hiyori/hiyori_free/runtime/hiyori_free_t08.moc3')
    expect(resolveFriendAssetPath('/tmp/dsh-friend', '../secret')).toBeUndefined()
    expect(resolveFriendAssetPath('/tmp/dsh-friend', '/etc/passwd')).toBeUndefined()
    expect(resolveFriendAssetPath('/tmp/dsh-friend', 'vendor/../secret')).toBeUndefined()
  })
})
