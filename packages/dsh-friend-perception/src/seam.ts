/**
 * Visual perception seam (openspec/specs/perception).
 *
 * v1 does not capture a screen or camera. The reserved provider reports
 * unavailable and `captureContext()` resolves an empty frame — it never
 * throws and never returns image bytes.
 */

export type PerceptionSource = 'none' | 'screen' | 'camera' | 'file'

export type PerceptionContentType =
  | 'unavailable'
  | 'image/png'
  | 'image/jpeg'
  | 'text/plain'

export type PerceptionFrame = {
  source: PerceptionSource
  /** ISO-8601 timestamp. */
  capturedAt: string
  contentType: PerceptionContentType
}

export type PerceptionUnavailableCode = 'multimodal-unavailable'

export type PerceptionCapabilities = {
  available: boolean
  screen: boolean
  camera: boolean
  reason: string
  reasonCode: PerceptionUnavailableCode | 'ready'
}

/**
 * Reserved provider contract.
 *
 * Spec names `captureContext()`. `capabilities()` is the honest
 * availability report so callers never have to guess by catching errors.
 */
export interface PerceptionProvider {
  readonly id: string
  capabilities(): PerceptionCapabilities
  captureContext(): Promise<PerceptionFrame>
}

export const UNAVAILABLE_PERCEPTION_ID = 'unavailable' as const

export const UNAVAILABLE_PERCEPTION_REASON = 'waiting-for-multimodal' as const

export const UNAVAILABLE_PERCEPTION_REASON_CODE: PerceptionUnavailableCode =
  'multimodal-unavailable'

export function unavailablePerceptionCapabilities(): PerceptionCapabilities {
  return {
    available: false,
    screen: false,
    camera: false,
    reason: UNAVAILABLE_PERCEPTION_REASON,
    reasonCode: UNAVAILABLE_PERCEPTION_REASON_CODE,
  }
}

export function unavailablePerceptionFrame(now: () => Date = () => new Date()): PerceptionFrame {
  return {
    source: 'none',
    capturedAt: now().toISOString(),
    contentType: 'unavailable',
  }
}

export function createUnavailablePerceptionProvider(): PerceptionProvider {
  return {
    id: UNAVAILABLE_PERCEPTION_ID,
    capabilities() {
      return unavailablePerceptionCapabilities()
    },
    async captureContext() {
      return unavailablePerceptionFrame()
    },
  }
}

export type PerceptionUnregister = () => void

export interface PerceptionRegistry {
  register(provider: PerceptionProvider): PerceptionUnregister
  get(id: string): PerceptionProvider | undefined
  list(): readonly PerceptionProvider[]
  /**
   * First provider that reports `available`, otherwise the reserved
   * unavailable stub. v1 only ever registers the stub.
   */
  active(): PerceptionProvider
}

export function createPerceptionRegistry(
  fallback: PerceptionProvider = createUnavailablePerceptionProvider(),
): PerceptionRegistry {
  const providers = new Map<string, PerceptionProvider>()

  return {
    register(provider) {
      const id = provider.id.trim()
      if (id.length === 0) {
        throw new Error('dsh-friend-perception: provider id must be non-empty')
      }
      providers.set(id, provider)
      return () => {
        if (providers.get(id) === provider) {
          providers.delete(id)
        }
      }
    },
    get(id) {
      return providers.get(id)
    },
    list() {
      return [...providers.values()]
    },
    active() {
      for (const provider of providers.values()) {
        if (provider.capabilities().available) {
          return provider
        }
      }
      return fallback
    },
  }
}

export type FriendPerception = {
  capabilities(): PerceptionCapabilities
  captureContext(): Promise<PerceptionFrame>
  register(provider: PerceptionProvider): PerceptionUnregister
  registry: PerceptionRegistry
}

export function createFriendPerception(
  registry: PerceptionRegistry = createPerceptionRegistry(),
): FriendPerception {
  return {
    registry,
    register(provider) {
      return registry.register(provider)
    },
    capabilities() {
      return registry.active().capabilities()
    },
    captureContext() {
      return registry.active().captureContext()
    },
  }
}
