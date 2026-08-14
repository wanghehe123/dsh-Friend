import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  FRIEND_STAGE_CHAT_DEDUPE_MS,
  FRIEND_STAGE_CHAT_PATH,
  postFriendStageChat,
  resetFriendStageChatDedupe,
} from '../src/send.ts'

afterEach(() => {
  resetFriendStageChatDedupe()
})

describe('postFriendStageChat', () => {
  it('drops a second POST of the same transcript inside the dedupe window', () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    postFriendStageChat('为什么哈啰', fetchImpl, 1_000)
    postFriendStageChat('为什么哈啰', fetchImpl, 1_000 + FRIEND_STAGE_CHAT_DEDUPE_MS - 1)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(FRIEND_STAGE_CHAT_PATH)
  })

  it('allows the same transcript after the window, and a different line immediately', () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    postFriendStageChat('为什么哈啰', fetchImpl, 1_000)
    postFriendStageChat('为什么哈啰', fetchImpl, 1_000 + FRIEND_STAGE_CHAT_DEDUPE_MS)
    postFriendStageChat('下一句', fetchImpl, 1_000 + FRIEND_STAGE_CHAT_DEDUPE_MS)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
