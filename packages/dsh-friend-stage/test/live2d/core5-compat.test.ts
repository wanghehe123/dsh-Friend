import { describe, expect, it } from 'vitest'

import {
  aliasCubism4FrameworkModel,
  aliasDrawableRenderOrders,
  installCubism5DrawableRenderOrderCompat,
} from '../../src/live2d/core5-compat.ts'

function core5Model(drawableCount = 3, offscreenCount = 1): {
  drawables: { count: number }
  renderOrders: Int32Array
} {
  const renderOrders = new Int32Array(drawableCount + offscreenCount)
  for (let i = 0; i < renderOrders.length; i += 1) {
    renderOrders[i] = i === 0 ? 2 : i === 1 ? 0 : i === 2 ? 1 : 99
  }
  return {
    drawables: { count: drawableCount },
    renderOrders,
  }
}

describe('Cubism 5 drawable render-order compat', () => {
  it('aliases Model.renderOrders onto drawables for the Cubism 4 renderer', () => {
    const model = core5Model()
    aliasDrawableRenderOrders(model)
    expect(Array.from(model.drawables.renderOrders as Int32Array)).toEqual([2, 0, 1])
  })

  it('leaves Core 4 drawables.renderOrders untouched', () => {
    const existing = new Int32Array([0, 1])
    const model = {
      drawables: { count: 2, renderOrders: existing },
      renderOrders: new Int32Array([9, 8, 7]),
    }
    aliasDrawableRenderOrders(model)
    expect(model.drawables.renderOrders).toBe(existing)
  })

  it('is a no-op when the Core 5 field is also missing', () => {
    const model = { drawables: { count: 2 } }
    aliasDrawableRenderOrders(model)
    expect((model.drawables as { renderOrders?: unknown }).renderOrders).toBeUndefined()
  })

  it('reads through Cubism 4 framework `_model`', () => {
    const native = core5Model()
    aliasCubism4FrameworkModel({ _model: native })
    expect(Array.from(native.drawables.renderOrders as Int32Array)).toEqual([2, 0, 1])
  })

  it('wraps Model.fromMoc once so later loads stay compatible', () => {
    const created = core5Model()
    const Model = {
      fromMoc: (moc: unknown) => {
        expect(moc).toBe('moc')
        return created
      },
    }
    const core = { Model }
    installCubism5DrawableRenderOrderCompat(core)
    installCubism5DrawableRenderOrderCompat(core)
    const model = Model.fromMoc('moc') as typeof created
    expect(model).toBe(created)
    expect(Array.from(model.drawables.renderOrders as Int32Array)).toEqual([2, 0, 1])
  })
})
