import { getHiyoriExpressionPreset, type HiyoriExpression } from './hiyori-adapter.ts'

/** Minimal Cubism Core surface used by the adapter; avoids coupling UI code to the renderer internals. */
export type HiyoriParameterWriter = {
  setParameterValueById(id: string, value: number, weight?: number): void
}

/**
 * Apply one expression frame after Hiyori's motion update.
 *
 * Hiyori's public sample does not have `.exp3.json` files. Its documented
 * parameter IDs let us create expressions non-destructively at runtime. The
 * mouth chooses the wider of expression and lip-sync opening so speech never
 * collapses a surprised or smiling pose.
 */
export function applyHiyoriFrame(
  model: HiyoriParameterWriter,
  expression: HiyoriExpression,
  lipSyncMouthOpen = 0,
  mouthOpenParam = 'ParamMouthOpenY',
): void {
  const preset = getHiyoriExpressionPreset(expression)
  for (const [id, value] of Object.entries(preset)) {
    if (id !== 'ParamMouthOpenY' && id !== mouthOpenParam) {
      model.setParameterValueById(id, value)
    }
  }

  const expressionMouthOpen = preset.ParamMouthOpenY ?? 0
  model.setParameterValueById(
    mouthOpenParam,
    Math.max(expressionMouthOpen, clampUnit(lipSyncMouthOpen)),
  )
}

export function applyLipSyncFrame(
  model: HiyoriParameterWriter,
  lipSyncMouthOpen: number,
  mouthOpenParam = 'ParamMouthOpenY',
): void {
  model.setParameterValueById(mouthOpenParam, clampUnit(lipSyncMouthOpen))
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}
