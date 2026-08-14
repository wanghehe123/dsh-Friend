import { applyHiyoriFrame, type HiyoriParameterWriter } from './hiyori-frame.ts'
import { isHiyoriExpression, type HiyoriExpression } from './hiyori-adapter.ts'

export type Live2DController = {
  setExpression(expression: HiyoriExpression): void
  setLipSync(level: number): void
  applyFrame(): void
  snapshot(): { expression: HiyoriExpression; lipSync: number }
}

/**
 * Parameter-write sequencer used by tests and the pet IIFE. The real Pixi
 * model is passed in as a {@link HiyoriParameterWriter}.
 */
export function createLive2DController(
  model: HiyoriParameterWriter,
  initial: HiyoriExpression = 'neutral',
): Live2DController {
  let expression: HiyoriExpression = initial
  let lipSync = 0

  return {
    setExpression(next) {
      if (!isHiyoriExpression(next)) return
      expression = next
    },
    setLipSync(level) {
      lipSync = Math.min(1, Math.max(0, level))
    },
    applyFrame() {
      applyHiyoriFrame(model, expression, lipSync)
    },
    snapshot() {
      return { expression, lipSync }
    },
  }
}
