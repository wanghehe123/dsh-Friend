/**
 * Every dsh.client apply() must survive a Cordis-faithful context:
 * undeclared property reads throw. Loose `{}` fakes missed this class of bug.
 */
import { describe, expect, it } from 'vitest'

import { apply as applyAsr, inject as injectAsr } from '../packages/dsh-friend-asr/src/client.ts'
import { apply as applyGrowth, inject as injectGrowth } from '../packages/dsh-friend-growth/src/client.ts'
import { apply as applyMemory, inject as injectMemory } from '../packages/dsh-friend-memory/src/client.ts'
import { apply as applyPersona, inject as injectPersona } from '../packages/dsh-friend-persona/src/client.ts'
import { apply as applyReactions, inject as injectReactions } from '../packages/dsh-friend-reactions/src/client.ts'
import { apply as applySettings, inject as injectSettings } from '../packages/dsh-friend-settings/src/client.ts'
import {
  createStrictCordisCtx,
} from '../packages/dsh-friend-shared/src/strict-cordis-ctx.ts'
import { apply as applyShared, inject as injectShared } from '../packages/dsh-friend-shared/src/client.ts'
import { apply as applyStage, inject as injectStage } from '../packages/dsh-friend-stage/src/client.ts'
import { apply as applyTts, inject as injectTts } from '../packages/dsh-friend-tts/src/client.ts'

type ClientApply = (ctx?: Record<string, unknown>) => unknown

const CLIENTS: ReadonlyArray<{
  name: string
  apply: ClientApply
  inject: readonly string[]
}> = [
  { name: '@wish233/dsh-friend-shared', apply: applyShared, inject: injectShared },
  { name: '@wish233/dsh-friend-tts', apply: applyTts, inject: injectTts },
  { name: '@wish233/dsh-friend-asr', apply: applyAsr, inject: injectAsr },
  { name: '@wish233/dsh-friend-settings', apply: applySettings, inject: injectSettings },
  { name: '@wish233/dsh-friend-reactions', apply: applyReactions, inject: injectReactions },
  { name: '@wish233/dsh-friend-stage', apply: applyStage, inject: injectStage },
  { name: '@wish233/dsh-friend-growth', apply: applyGrowth, inject: injectGrowth },
  { name: '@wish233/dsh-friend-memory', apply: applyMemory, inject: injectMemory },
  { name: '@wish233/dsh-friend-persona', apply: applyPersona, inject: injectPersona },
]

function disposeApplyResult(result: unknown, effectDisposers: Array<() => void>): void {
  for (const closer of effectDisposers.splice(0).reverse()) {
    closer()
  }
  if (result !== null && typeof result === 'object' && 'dispose' in result) {
    const dispose = (result as { dispose?: unknown }).dispose
    if (typeof dispose === 'function') {
      dispose.call(result)
    }
  }
}

describe('strict Cordis client context', () => {
  it('throws on undeclared reads and returns declared values', () => {
    const settingsScope = { bind() { return undefined } }
    const ctx = createStrictCordisCtx({
      inject: ['settingsScope'],
      values: { settingsScope },
    })
    expect(ctx.settingsScope).toBe(settingsScope)
    expect(ctx.effect).toBeUndefined()
    expect(() => ctx.speechSynthesis).toThrow(/cannot get property "speechSynthesis" without inject/)
    expect(() => ctx.document).toThrow(/cannot get property "document" without inject/)
  })

  it.each(CLIENTS)('$name apply() does not throw on a strict ctx', ({ apply, inject }) => {
    const effectDisposers: Array<() => void> = []
    const ctx = createStrictCordisCtx({
      inject: [...inject],
      values: {
        effect(execute) {
          effectDisposers.push(execute())
        },
      },
    })
    let result: unknown
    try {
      expect(() => {
        result = apply(ctx)
      }).not.toThrow()
    } finally {
      disposeApplyResult(result, effectDisposers)
    }
  })
})
