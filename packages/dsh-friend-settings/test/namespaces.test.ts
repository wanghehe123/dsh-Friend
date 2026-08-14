import { FRIEND_SETTINGS_NAMESPACES, SETTINGS_NAMESPACE_PATTERN } from '@wish233/dsh-friend-shared/universal'
import { describe, expect, it } from 'vitest'

import { CORE_SETTINGS_NAMESPACE } from '../src/core-settings.ts'

describe('settings namespaces used by the configuration center', () => {
  it('are kebab-case and match the official settingsNamespace pattern', () => {
    const values = Object.values(FRIEND_SETTINGS_NAMESPACES)
    expect(values).toContain('friend-core')
    expect(CORE_SETTINGS_NAMESPACE).toBe('friend-core')
    for (const namespace of values) {
      expect(namespace).toMatch(SETTINGS_NAMESPACE_PATTERN)
      expect(namespace.includes('.')).toBe(false)
    }
  })
})
