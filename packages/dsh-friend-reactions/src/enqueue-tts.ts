/**
 * Voice-level quip channel. Host `enqueueTts` is not injected in production;
 * the client reuses the TTS preview path that just landed:
 * `POST /friend/tts/preview` + `window.__DSH_FRIEND_TTS__.preview`.
 *
 * TTS package does not need a change for this half — we call the public
 * client global / HTTP contract. If that global is missing, the POST still
 * pushes a `tts-ready` frame on `/friend/tts/events` for the TTS client.
 */

export const FRIEND_TTS_PREVIEW_PATH = '/friend/tts/preview' as const
export const FRIEND_TTS_CLIENT_GLOBAL = '__DSH_FRIEND_TTS__' as const

export type FriendTtsPreviewClient = {
  preview: (text: string) => unknown
}

export type EnqueueReactionTtsOptions = {
  fetch?: (
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => Promise<unknown>
  tts?: FriendTtsPreviewClient
}

export function enqueueReactionTts(
  text: string,
  options: EnqueueReactionTtsOptions = {},
): void {
  if (text.trim().length === 0) {
    return
  }
  const bag = globalThis as typeof globalThis & {
    [FRIEND_TTS_CLIENT_GLOBAL]?: FriendTtsPreviewClient
  }
  const tts = options.tts ?? bag[FRIEND_TTS_CLIENT_GLOBAL]
  if (typeof tts?.preview === 'function') {
    void tts.preview(text)
    return
  }
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return
  }
  void fetchImpl(FRIEND_TTS_PREVIEW_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}
