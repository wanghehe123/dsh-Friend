import { describe, expect, it } from 'vitest'

import { EN, I18N_KEYS, ZH, missingI18nKeys, t } from '../src/i18n.ts'

describe('settings i18n', () => {
  it('keeps zh and en key sets equal', () => {
    expect(Object.keys(ZH).sort()).toEqual([...I18N_KEYS].sort())
    expect(Object.keys(EN).sort()).toEqual([...I18N_KEYS].sort())
    expect(missingI18nKeys()).toEqual({ zh: [], en: [] })
  })

  it('falls back to zh when the english entry is missing', () => {
    const leaked = Object.values(EN).some((value) => /[\u4e00-\u9fff]/u.test(value))
    expect(leaked).toBe(false)
    expect(t('card.save', 'en')).toBe('Save')
    expect(t('card.save', 'zh')).toBe('保存')
    expect(t('card.save', 'system', 'en-US')).toBe('Save')
    expect(t('card.save', 'system', 'zh-CN')).toBe('保存')
  })
})
