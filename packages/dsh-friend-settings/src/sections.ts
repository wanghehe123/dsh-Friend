export const CONFIG_CENTER_SECTIONS = [
  'model',
  'persona',
  'tts',
  'asr',
  'stage',
  'memory',
  'growth',
  'reactions',
  'float',
  'about',
] as const

export type ConfigCenterSection = (typeof CONFIG_CENTER_SECTIONS)[number]

export const DEFAULT_CONFIG_SECTION: ConfigCenterSection = 'model'

export const CONFIG_HASH_PREFIX = '#/friend/config'
export const FRIEND_OPEN_SETTINGS_EVENT = 'dsh-friend:open-settings' as const

export function isConfigCenterSection(value: string): value is ConfigCenterSection {
  return (CONFIG_CENTER_SECTIONS as readonly string[]).includes(value)
}

export function parseConfigHash(hash: string): {
  open: boolean
  section: ConfigCenterSection
} {
  const trimmed = hash.trim()
  if (trimmed === CONFIG_HASH_PREFIX || trimmed === `${CONFIG_HASH_PREFIX}/`) {
    return { open: true, section: DEFAULT_CONFIG_SECTION }
  }
  const prefix = `${CONFIG_HASH_PREFIX}/`
  if (!trimmed.startsWith(prefix)) {
    return { open: false, section: DEFAULT_CONFIG_SECTION }
  }
  const rest = trimmed.slice(prefix.length).split(/[/?#]/u)[0] ?? ''
  if (isConfigCenterSection(rest)) {
    return { open: true, section: rest }
  }
  return { open: true, section: DEFAULT_CONFIG_SECTION }
}

export function serializeConfigHash(section: ConfigCenterSection): string {
  return `${CONFIG_HASH_PREFIX}/${section}`
}

export type OverlayState = {
  open: boolean
  section: ConfigCenterSection
}

export type OverlayController = {
  getState(): OverlayState
  open(section?: ConfigCenterSection): void
  close(): void
  setSection(section: ConfigCenterSection): void
  syncFromHash(): OverlayState
}

export type OverlayLocation = {
  getHash(): string
  setHash(hash: string): void
}

export function createOverlayController(location: OverlayLocation): OverlayController {
  let previousHash = ''
  let state = parseConfigHash(location.getHash())

  const write = (next: OverlayState): void => {
    state = next
    if (next.open) {
      location.setHash(serializeConfigHash(next.section))
    }
  }

  return {
    getState() {
      return { ...state }
    },
    open(section) {
      if (!state.open) {
        previousHash = location.getHash()
      }
      write({
        open: true,
        section: section ?? state.section,
      })
    },
    close() {
      state = { open: false, section: state.section }
      const restore = previousHash
      previousHash = ''
      if (restore.length > 0 && !parseConfigHash(restore).open) {
        location.setHash(restore)
        return
      }
      location.setHash('')
    },
    setSection(section) {
      if (!state.open) {
        this.open(section)
        return
      }
      write({ open: true, section })
    },
    syncFromHash() {
      state = parseConfigHash(location.getHash())
      return { ...state }
    },
  }
}

export type SectionLoader<T> = {
  load(section: ConfigCenterSection): T
  loaded(): readonly ConfigCenterSection[]
}

/**
 * Lazy section table: a loader runs only when that section is requested.
 * Inactive sections stay untouched so the overlay can mount one pane at a time.
 */
export function createSectionLoader<T>(
  registry: Readonly<Record<ConfigCenterSection, () => T>>,
): SectionLoader<T> {
  const seen: ConfigCenterSection[] = []
  return {
    load(section) {
      if (!seen.includes(section)) {
        seen.push(section)
      }
      return registry[section]()
    },
    loaded() {
      return [...seen]
    },
  }
}
