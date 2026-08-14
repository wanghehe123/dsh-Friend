/**
 * React is a dsh web platform seed. Do not `import` it from the client
 * entry — tsdown would hoist `require("react")` to factory evaluation,
 * and `shared/tsdown.client.test.ts` materializes factories with an
 * empty module table. Call this only from slot render callbacks.
 */
export type FriendReact = {
  createElement: (
    type: unknown,
    props?: object | null,
    ...children: unknown[]
  ) => unknown
  useState: <S>(initial: S | (() => S)) => [S, (value: S | ((prev: S) => S)) => void]
  useMemo: <T>(factory: () => T, deps: readonly unknown[]) => T
  useEffect?: (effect: () => void | (() => void), deps?: readonly unknown[]) => void
}

export function friendReact(): FriendReact {
  const injected = (globalThis as { __dshFriendReact__?: unknown }).__dshFriendReact__
  const loaded: unknown = injected ?? require('react')
  if (!isFriendReact(loaded)) {
    throw new Error('dsh-friend-settings: platform seed "react" is not a usable module')
  }
  return loaded
}

function isFriendReact(value: unknown): value is FriendReact {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const candidate = value as { createElement?: unknown; useState?: unknown; useMemo?: unknown }
  return typeof candidate.createElement === 'function'
    && typeof candidate.useState === 'function'
    && typeof candidate.useMemo === 'function'
}
