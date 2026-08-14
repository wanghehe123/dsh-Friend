import {
  FRIEND_PRESET_IDS,
  FRIEND_SETTINGS_NAMESPACES,
  logPluginMount,
  registerFriendSettings,
  type FriendPushEvent,
  type FriendRouteContext,
} from '@wish233/dsh-friend-shared'

import { observeRawEvent, type SessionEventSource } from './observe.ts'
import { createReactEngine, type EnqueueTts, type ReactionSnapshot, type ReactEngine } from './react.ts'
import { registerReactionRoutes } from './routes.ts'
import {
  resolveReactionSettings,
  type ReactionLevel,
  type ReactionSettings,
  type SettingsReader,
} from './settings.ts'
import {
  createFriendReactionsSettingsSchema,
  DEFAULT_REACTIONS_SETTINGS_ENTRY,
} from './settings-schema.ts'

export const name = '@wish233/dsh-friend-reactions'

/**
 * Cordis services this plugin may read. Accessing `ctx.webServer` /
 * `ctx.settings` without the matching inject throws and takes down the host tree.
 * `ctx.on` is a Context method (not a service) — do not list it here.
 */
export const inject = ['webServer', 'settings'] as const

/** Official Cordis event name from `@deepseek-ai/dsh-session`. */
export const SESSION_EVENT_NAME = 'session/event' as const

export type ReactionsApplyRole = 'host' | 'companion-preset'

export interface FriendReactionsContext {
  effect?(
    execute: () => (() => void | Promise<void>),
    label?: string,
  ): () => void | Promise<void>
  webServer?: FriendRouteContext['webServer']
  settings?: SettingsReader
  on?(event: string, handler: (...args: unknown[]) => unknown): unknown
}

export interface ReactionsApplyOptions {
  role?: ReactionsApplyRole
  eventSource?: SessionEventSource
  enqueueTts?: EnqueueTts
  push?: (event: FriendPushEvent) => void
  now?: () => number
  random?: () => number
}

export interface ReactionsApplyHandle {
  dispose: () => void
  role: ReactionsApplyRole
  engine: ReactEngine
  notify: (session: unknown, event: unknown) => ReactionSnapshot | undefined
}

export function apply(ctx: FriendReactionsContext, config: ReactionsApplyOptions = {}): () => void {
  return applyReactions(ctx, config).dispose
}

export function applyReactions(
  ctx: FriendReactionsContext,
  config: ReactionsApplyOptions = {},
): ReactionsApplyHandle {
  const role = config.role ?? 'host'
  logPluginMount(name)
  console.info(`[${name}] apply() role=${role}`)

  const settings = ctx.settings
  if (role === 'host') {
    registerFriendSettings(
      ctx,
      FRIEND_SETTINGS_NAMESPACES.reactions,
      createFriendReactionsSettingsSchema(),
      DEFAULT_REACTIONS_SETTINGS_ENTRY,
    )
  }
  let levelOverride: ReactionLevel | undefined
  // Re-read both `friend-core.enabled` and `friend-reactions.enabled` (AND)
  // on every event. Host has no consumer subscribe for other namespaces.
  const readSettings = (): ReactionSettings => {
    const live = resolveReactionSettings(settings)
    return levelOverride === undefined ? live : { ...live, level: levelOverride }
  }

  const engine = createReactEngine({
    settings: readSettings,
    ...(config.now !== undefined ? { now: config.now } : {}),
    ...(config.random !== undefined ? { random: config.random } : {}),
    ...(config.enqueueTts !== undefined ? { enqueueTts: config.enqueueTts } : {}),
  })

  const disposers: Array<() => void> = []
  let pushFrame: ((snapshot: object) => void) | undefined

  if (role === 'companion-preset') {
    return {
      dispose: () => undefined,
      role,
      engine,
      notify: () => undefined,
    }
  }

  if (ctx.webServer !== undefined && ctx.effect !== undefined) {
    const routes = registerReactionRoutes(
      { webServer: ctx.webServer, effect: ctx.effect },
      {
        engine,
        settings: readSettings,
        setLevel: (level) => {
          levelOverride = level
        },
      },
    )
    pushFrame = routes.push
  } else {
    console.warn(`[${name}] ctx.webServer/effect missing; reaction routes not mounted`)
  }

  const notify = (session: unknown, event: unknown): ReactionSnapshot | undefined => {
    const current = readSettings()
    const work = observeRawEvent(session, event, {
      mutedSessions: current.mutedSessions,
    })
    if (work === undefined) {
      return undefined
    }
    const snapshot = engine.react(work)
    if (snapshot === undefined) {
      return undefined
    }
    pushFrame?.(snapshot)
    config.push?.({ type: 'reaction', payload: snapshot })
    return snapshot
  }

  const source = config.eventSource ?? wrapContextEvents(ctx)
  if (source !== undefined) {
    disposers.push(source.subscribe((session, event) => {
      notify(session, event)
    }))
  }

  return {
    dispose: () => {
      for (const closer of disposers.splice(0).reverse()) {
        closer()
      }
    },
    role,
    engine,
    notify,
  }
}

/**
 * Wrap `ctx.on('session/event')` without a runtime `@deepseek-ai/*` import.
 *
 * Official: `Context.on` + event name `session/event`
 * (`@deepseek-ai/dsh-session` `lib/types/index.d.ts` 66):
 * `(session, event)`. Passing only `args[0]` feeds a `Session` (has `id`,
 * no `type`) into the classifier and every event is dropped.
 */
export function wrapContextEvents(ctx: FriendReactionsContext): SessionEventSource | undefined {
  if (typeof ctx.on !== 'function') {
    return undefined
  }
  const on = ctx.on.bind(ctx)
  return {
    subscribe(handler) {
      const dispose = on(SESSION_EVENT_NAME, (...args: unknown[]) => {
        const { session, event } = normalizeSessionEventArgs(args)
        handler(session, event)
      })
      return () => {
        if (typeof dispose === 'function') {
          dispose()
        }
      }
    },
  }
}

export function normalizeSessionEventArgs(args: readonly unknown[]): {
  session: unknown
  event: unknown
} {
  if (args.length >= 2) {
    return { session: args[0], event: args[1] }
  }
  const first = args[0]
  if (isPlainObject(first) && first.session !== undefined && first.event !== undefined) {
    return { session: first.session, event: first.event }
  }
  return { session: first, event: undefined }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export { FRIEND_SETTINGS_NAMESPACES, FRIEND_PRESET_IDS }
export { observeRawEvent, isCompanionPreset, COMPANION_PRESET_IDS, type WorkEvent } from './observe.ts'
export { createReactEngine, type ReactionSnapshot } from './react.ts'
export { createQuipPicker, attachQuip, QUIP_WINDOW, quipsFor } from './quips.ts'
export { mapWorkEvent, REACTION_MAPPING } from './mapping.ts'
export { isDoNotDisturb, isInQuietHours, cronMatches } from './dnd.ts'
export {
  resolveReactionSettings,
  reactionsAreLive,
  DEFAULT_REACTION_SETTINGS,
  REACTIONS_SETTINGS_NAMESPACE,
  CORE_SETTINGS_NAMESPACE,
} from './settings.ts'
export { createReactionRoutes } from './routes.ts'
export { renderReactionsPage } from './ui-page.ts'
