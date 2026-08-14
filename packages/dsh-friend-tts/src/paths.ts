/** Prefix route for cached TTS audio. rc.6 WebRoute has no `:param` matcher. */
export const FRIEND_TTS_AUDIO_PATH = '/friend/tts/audio' as const

/**
 * TTS-owned SSE downlink. Stage already registered `GET /friend/events`
 * via shared `pushToClient`; a second registrant would collide. TTS therefore
 * owns this sibling path and accepts an injected sink if a later change
 * multiplexes `tts-ready` onto the stage channel.
 */
export const FRIEND_TTS_EVENTS_PATH = '/friend/tts/events' as const

/** Explicit preview / 试听. Not gated by `autoSpeak`. Does not need an LLM. */
export const FRIEND_TTS_PREVIEW_PATH = '/friend/tts/preview' as const
