/**
 * Client-safe voice catalogs. Kept free of `node:` / provider transports so
 * the settings form can list voices without pulling Edge WSS into the
 * ModuleLoader factory.
 */
import {
  FRIEND_TTS_BROWSER_PROVIDER,
  FRIEND_TTS_DEFAULT_PROVIDER,
  FRIEND_TTS_OPENAI_COMPAT_PROVIDER,
  type FriendTtsVoice,
} from './seam.ts'

export const EDGE_BUILTIN_VOICES: readonly FriendTtsVoice[] = [
  { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao (晓晓)', language: 'zh-CN', gender: 'female' },
  { id: 'zh-CN-YunxiNeural', name: 'Yunxi (云希)', language: 'zh-CN', gender: 'male' },
  { id: 'zh-CN-XiaoyiNeural', name: 'Xiaoyi (晓伊)', language: 'zh-CN', gender: 'female' },
  { id: 'en-US-AriaNeural', name: 'Aria', language: 'en-US', gender: 'female' },
  { id: 'en-US-GuyNeural', name: 'Guy', language: 'en-US', gender: 'male' },
]

export const OPENAI_COMPAT_VOICES: readonly FriendTtsVoice[] = [
  { id: 'alloy', name: 'Alloy', language: 'en', gender: 'neutral' },
  { id: 'echo', name: 'Echo', language: 'en', gender: 'male' },
  { id: 'fable', name: 'Fable', language: 'en', gender: 'neutral' },
  { id: 'onyx', name: 'Onyx', language: 'en', gender: 'male' },
  { id: 'nova', name: 'Nova', language: 'en', gender: 'female' },
  { id: 'shimmer', name: 'Shimmer', language: 'en', gender: 'female' },
]

export function listCatalogVoices(provider: string | undefined): readonly FriendTtsVoice[] {
  const id = provider?.trim() || FRIEND_TTS_DEFAULT_PROVIDER
  if (id === FRIEND_TTS_OPENAI_COMPAT_PROVIDER) {
    return OPENAI_COMPAT_VOICES
  }
  if (id === FRIEND_TTS_BROWSER_PROVIDER) {
    return []
  }
  return EDGE_BUILTIN_VOICES
}
