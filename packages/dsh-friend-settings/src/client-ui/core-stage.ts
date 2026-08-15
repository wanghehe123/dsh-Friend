export const FRIEND_CORE_STAGE_EVENT = 'dsh-friend:core-stage' as const

export type CoreStageDetail = {
  enabled: boolean
  floatEnabled: boolean
}

export type CoreStageTarget = {
  dispatchEvent?(event: { type: string; detail?: CoreStageDetail }): unknown
}

export function dispatchFriendCoreStage(
  core: CoreStageDetail,
  target: CoreStageTarget = globalThis,
): void {
  const detail = { enabled: core.enabled, floatEnabled: core.floatEnabled }
  const ctor = (globalThis as {
    CustomEvent?: new (name: string, init: { detail: CoreStageDetail }) => { type: string; detail?: CoreStageDetail }
  }).CustomEvent
  if (typeof ctor === 'function' && typeof target.dispatchEvent === 'function') {
    try {
      target.dispatchEvent(new ctor(FRIEND_CORE_STAGE_EVENT, { detail }))
      return
    } catch {
      // fake windows accept a plain { type, detail }
    }
  }
  target.dispatchEvent?.({ type: FRIEND_CORE_STAGE_EVENT, detail })
}
