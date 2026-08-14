import {
  createMemorySessionIdStore,
  createSettingsSessionIdStore,
  sendToCompanion,
  subscribeCompanionReplies,
  wrapContextSessionEvents,
  type FriendSessionEventContext,
} from '@wish233/dsh-friend-persona'
import {
  bindHostSettings,
  readDefaultModelSelection,
  type FriendAgentRegistry,
  type FriendDefaultModelContext,
  type FriendPresetContext,
} from '@wish233/dsh-friend-shared'

import { StreamingTagParser } from './tag-parser.ts'

/**
 * Host-side send into the standing companion session.
 *
 * Persona exports `sendToCompanion` and `subscribeCompanionReplies`.
 * Host `apply()` binds the latter to the chat tracker so the bubble shows
 * stripped body text. {@link CompanionReplyWatch} remains a per-POST test
 * seam; production uses the process-wide `session/event` subscription.
 */
export type CompanionSendResult = Readonly<{
  sessionId: string
  sent: boolean
  error?: string
}>

export type CompanionSend = (text: string) => Promise<CompanionSendResult>

export type CompanionReplyWatch = (
  sessionId: string,
  onDelta: (text: string, done: boolean) => void,
) => () => void

export type CompanionSendContext = {
  agents?: FriendAgentRegistry
  settings?: {
    get(namespace: string): unknown
    update?(namespace: string, patch: Record<string, unknown>): Promise<void>
  }
  agentPresets?: FriendPresetContext['agentPresets'] | undefined
  agentDefaultModel?: FriendDefaultModelContext['agentDefaultModel'] | undefined
  on?: FriendSessionEventContext['on']
}

/**
 * Build a send function from host `ctx.agents` / `ctx.settings`.
 *
 * Callers must declare `agents`, `settings`, `agentDefaultModel`, and
 * `agentPresets` on `export const inject`. Without the last two, create
 * leaves `deployment:persona` in place and `{{model}}` has no value.
 * Cordis resolves services in the Proxy `get` trap — they are never own
 * properties — so `hasOwnProperty` probes always miss. A missing `agents`
 * value returns `undefined` so the route can 503.
 */
export function bindPersonaSend(ctx: CompanionSendContext): CompanionSend | undefined {
  const agents = ctx.agents
  if (agents === undefined) return undefined
  const settings = ctx.settings
  const store = settings === undefined || settings.update === undefined
    ? createMemorySessionIdStore()
    : createSettingsSessionIdStore(bindHostSettings({
      get(namespace) {
        return settings.get(namespace)
      },
      update(namespace, patch) {
        if (settings.update === undefined) {
          return Promise.resolve()
        }
        return settings.update(namespace, patch)
      },
    }))
  return (text) => sendToCompanion(text, {
    registry: agents,
    store,
    ...companionSendExtras(ctx),
  })
}

function companionSendExtras(
  ctx: CompanionSendContext,
): {
  getDefaultModel?: () => ReturnType<typeof readDefaultModelSelection>
  mountPreset?: (agentCtx: unknown, id: string) => Promise<void>
} {
  const presets = ctx.agentPresets
  const defaultModel = ctx.agentDefaultModel
  return {
    ...(presets !== undefined && typeof presets.mount === 'function'
      ? {
          mountPreset: async (agentCtx: unknown, id: string) => {
            await presets.mount?.(agentCtx, id)
          },
        }
      : {}),
    ...(defaultModel === undefined
      ? {}
      : {
          getDefaultModel: () => readDefaultModelSelection({ agentDefaultModel: defaultModel }),
        }),
  }
}

/**
 * Per-session watch used by `POST /friend/stage/chat` tests.
 * Production host apply() uses {@link createCompanionStageSink} instead so
 * replies from the main conversation UI also reach the bubble.
 */
export function bindPersonaWatch(ctx: CompanionSendContext): CompanionReplyWatch | undefined {
  const source = wrapContextSessionEvents(ctx)
  if (source === undefined) return undefined
  return (sessionId, onDelta) => {
    let parser = new StreamingTagParser()
    let display = ''
    return subscribeCompanionReplies(source, (delta) => {
      if (delta.sessionId !== sessionId) return
      if (delta.reset || (delta.mode === 'replace' && delta.rawDelta.length > 0)) {
        parser = new StreamingTagParser()
        display = ''
      }
      if (delta.rawDelta.length > 0) {
        display += parser.push(delta.rawDelta).displayText
      }
      if (delta.done) {
        display += parser.flush().displayText
      }
      onDelta(display, delta.done)
    })
  }
}
