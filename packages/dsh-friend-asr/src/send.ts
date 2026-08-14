/**
 * Default destination for a final ASR transcript in the dsh web UI.
 *
 * The companion conversation already accepts `POST /friend/stage/chat`
 * (same path the standalone pet page uses). dsh's own session input would
 * land in whatever coding session is focused — the wrong place for Friend.
 */
export const FRIEND_STAGE_CHAT_PATH = '/friend/stage/chat' as const

export function postFriendStageChat(
  text: string,
  fetchImpl: typeof fetch = fetch,
): void {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return
  }
  void fetchImpl(FRIEND_STAGE_CHAT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: trimmed }),
  })
}
