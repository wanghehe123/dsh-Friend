/**
 * Host → client push event union shared by both halves.
 *
 * Official downlink (`/api/events.mux`, `/api/events.host`, and
 * `API_REMOTE_FORWARDED_EVENTS` in `@deepseek-ai/dsh-api-remotes`) is a
 * closed whitelist — plugins cannot add `friend/*` names. Friend therefore
 * uses a dedicated SSE route instead of `ctx.emit` / MuxFrame.
 *
 * Replacement: if a later Harness release exposes an extensible plugin
 * downlink, keep this union and swap only the host `pushToClient` transport.
 */

/** Exact SSE path. Do not hang this under `/api/*` (connection trust fence). */
export const FRIEND_EVENTS_PATH = '/friend/events' as const

export type FriendPushEvent =
  | { type: 'expr'; payload: unknown }
  | { type: 'motion'; payload: unknown }
  | { type: 'cue'; payload: unknown }
  | { type: 'reaction'; payload: unknown }
  | { type: 'tts-ready'; payload: unknown }
  | { type: 'asset-progress'; payload: unknown }

export type FriendPushEventType = FriendPushEvent['type']
