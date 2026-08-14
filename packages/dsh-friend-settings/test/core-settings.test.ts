import { describe, expect, it } from 'vitest'

import { childControlsEnabled, readCoreSettings, resolveUiLanguage } from '../src/core-settings.ts'

describe('friend-core settings', () => {
  it('reads defaults and resolves the UI language', () => {
    expect(readCoreSettings(undefined)).toMatchObject({
      enabled: true,
      floatEnabled: true,
      volume: 1,
      muted: false,
      language: 'system',
    })
    expect(resolveUiLanguage('en')).toBe('en')
    expect(resolveUiLanguage('system', 'en-GB')).toBe('en')
    expect(resolveUiLanguage('system', 'zh-CN')).toBe('zh')
    expect(childControlsEnabled(readCoreSettings({ enabled: false }))).toBe(false)
  })
})
