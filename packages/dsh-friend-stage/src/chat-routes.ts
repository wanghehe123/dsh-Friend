import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

import type { ChatTracker } from './chat-state.ts'
import type { CompanionReplyWatch, CompanionSend } from './companion-send.ts'
import { isGet, readJsonBody, writeJson, writeText } from './http-util.ts'

export type ChatRouteOptions = Readonly<{
  chat: ChatTracker
  send?: CompanionSend
  watch?: CompanionReplyWatch
}>

export function createChatRoutes(options: ChatRouteOptions): readonly WebRoute[] {
  return [
    {
      kind: 'exact',
      path: '/friend/stage/chat',
      async handler(request, response) {
        if (isGet(request)) {
          return writeJson(response, options.chat.snapshot())
        }
        if (request.method !== 'POST') return writeText(response, 'Method Not Allowed', 405)
        try {
          const body = await readJsonBody(request)
          const text = typeof body === 'object' && body !== null && 'text' in body
            ? body.text
            : undefined
          if (typeof text !== 'string' || text.trim().length === 0) {
            return writeJson(response, { ok: false, error: 'text is required' }, 400)
          }
          if (options.send === undefined) {
            return writeJson(response, {
              ok: false,
              error: 'Companion send is not wired (persona agents missing). Inject sendCompanion on stage apply().',
            }, 503)
          }
          options.chat.beginSend(text.trim())
          const result = await options.send(text.trim())
          if (!result.sent) {
            options.chat.markFailed(result.error ?? 'Companion session did not accept the message')
            return writeJson(response, { ok: false, ...options.chat.snapshot() }, 502)
          }
          options.chat.markSent(result.sessionId)
          // Optional per-POST seam. Production host apply() also subscribes
          // to `session/event` via persona `subscribeCompanionReplies` so
          // the tracker gets stripped body without this watch.
          if (options.watch !== undefined) {
            options.watch(result.sessionId, (delta, done) => {
              options.chat.applyAssistant(delta, 'replace')
              if (done) options.chat.finish()
            })
          }
          writeJson(response, { ok: true, ...options.chat.snapshot() })
        } catch (error) {
          options.chat.markFailed(error instanceof Error ? error.message : String(error))
          writeJson(response, { ok: false, ...options.chat.snapshot() }, 400)
        }
      },
    },
  ]
}
