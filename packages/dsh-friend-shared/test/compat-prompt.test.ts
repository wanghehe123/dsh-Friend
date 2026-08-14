import { describe, expect, it, vi } from 'vitest'

import { registerPromptSection } from '../src/dsh-compat.ts'

describe('registerPromptSection', () => {
  it('forwards the section to systemPrompt.section and returns that disposer unchanged', () => {
    const disposeSection = vi.fn()
    const section = vi.fn(() => disposeSection)
    const effect = vi.fn()
    const spec = {
      name: 'friend:persona',
      order: 10,
      text: 'You are a companion.',
    }

    const dispose = registerPromptSection(
      { systemPrompt: { section }, effect },
      spec,
    )

    expect(section).toHaveBeenCalledOnce()
    expect(section).toHaveBeenCalledWith(spec)
    expect(dispose).toBe(disposeSection)
    expect(effect).not.toHaveBeenCalled()
    dispose()
    expect(disposeSection).toHaveBeenCalledOnce()
  })
})
