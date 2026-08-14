import { logPluginMount } from '@wish233/dsh-friend-shared'

import {
  createFriendPerception,
  type FriendPerception,
} from './seam.ts'

export const name = '@wish233/dsh-friend-perception'

/**
 * This plugin does not read `ctx.<service>`. Do not add inject entries
 * until a future provider actually needs a host service.
 */

export type FriendPerceptionContext = {
  effect?(
    execute: () => (() => void | Promise<void>),
    label?: string,
  ): () => void | Promise<void>
}

export type FriendPerceptionHandle = {
  dispose: () => void
  perception: FriendPerception
}

const perception = createFriendPerception()

export function getFriendPerception(): FriendPerception {
  return perception
}

export function apply(_ctx: FriendPerceptionContext = {}): () => void {
  return applyPerception(_ctx).dispose
}

export function applyPerception(_ctx: FriendPerceptionContext = {}): FriendPerceptionHandle {
  logPluginMount(name)
  return {
    perception,
    dispose() {},
  }
}

export {
  UNAVAILABLE_PERCEPTION_ID,
  UNAVAILABLE_PERCEPTION_REASON,
  UNAVAILABLE_PERCEPTION_REASON_CODE,
  createFriendPerception,
  createPerceptionRegistry,
  createUnavailablePerceptionProvider,
  unavailablePerceptionCapabilities,
  unavailablePerceptionFrame,
  type FriendPerception,
  type PerceptionCapabilities,
  type PerceptionContentType,
  type PerceptionFrame,
  type PerceptionProvider,
  type PerceptionRegistry,
  type PerceptionSource,
  type PerceptionUnavailableCode,
  type PerceptionUnregister,
} from './seam.ts'
