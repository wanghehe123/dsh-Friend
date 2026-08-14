/**
 * Default destination for a final ASR transcript in the dsh web UI.
 *
 * The companion conversation already accepts `POST /friend/stage/chat`
 * (same path the standalone pet page uses). dsh's own session input would
 * land in whatever coding session is focused — the wrong place for Friend.
 */
export const FRIEND_STAGE_CHAT_PATH = '/friend/stage/chat' as const

/** Drop a second POST of the same transcript (two ASR clients, or a late echo). */
export const FRIEND_STAGE_CHAT_DEDUPE_MS = 2_500

let lastPostedText = ''
let lastPostedAt = 0

export function resetFriendStageChatDedupe(): void {
  lastPostedText = ''
  lastPostedAt = 0
}

export function postFriendStageChat(
  text: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): void {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return
  }
  if (trimmed === lastPostedText && now - lastPostedAt < FRIEND_STAGE_CHAT_DEDUPE_MS) {
    return
  }
  lastPostedText = trimmed
  lastPostedAt = now
  void fetchImpl(FRIEND_STAGE_CHAT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: trimmed }),
  })
}
