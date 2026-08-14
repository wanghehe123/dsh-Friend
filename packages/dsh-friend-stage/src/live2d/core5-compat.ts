/**
 * Cubism 5 Core moved `renderOrders` from `drawables` onto the Model
 * (`drawableCount + offscreenCount`). `pixi-live2d-display@0.4.0` still
 * uses the Cubism 4 framework, which reads `drawables.renderOrders` in
 * `doDrawModel`. When that field is missing the renderer throws
 * `Cannot read properties of undefined (reading '0')` every frame and
 * even moc v4 models (Hiyori) stay blank.
 */

const patchedModels = new WeakSet<object>()

type Core5Drawables = {
  count?: number
  renderOrders?: ArrayLike<number>
}

type Core5Model = {
  drawables?: Core5Drawables
  renderOrders?: Int32Array | ArrayLike<number>
}

export function aliasDrawableRenderOrders(model: unknown): void {
  if (model === null || typeof model !== 'object') {
    return
  }
  const record = model as Core5Model
  const drawables = record.drawables
  if (drawables === undefined || drawables.renderOrders != null) {
    return
  }
  if (record.renderOrders == null) {
    return
  }
  Object.defineProperty(drawables, 'renderOrders', {
    configurable: true,
    enumerable: true,
    get() {
      const current = record.renderOrders
      if (current == null) {
        return undefined
      }
      const count = typeof drawables.count === 'number' && Number.isFinite(drawables.count)
        ? Math.max(0, Math.min(current.length, Math.floor(drawables.count)))
        : 0
      return typeof (current as Int32Array).subarray === 'function'
        ? (current as Int32Array).subarray(0, count)
        : current
    },
  })
}

/** Cubism 4 `CubismModel` stores the native Core model on `_model`. */
export function aliasCubism4FrameworkModel(coreModel: unknown): void {
  if (coreModel === null || typeof coreModel !== 'object') {
    return
  }
  aliasDrawableRenderOrders((coreModel as { _model?: unknown })._model)
}

export function installCubism5DrawableRenderOrderCompat(core: unknown): void {
  if (core === null || typeof core !== 'object') {
    return
  }
  const Model = (core as {
    Model?: { fromMoc?: (moc: unknown) => unknown }
  }).Model
  if (Model === undefined || typeof Model.fromMoc !== 'function') {
    return
  }
  if (patchedModels.has(Model)) {
    return
  }
  const original = Model.fromMoc.bind(Model)
  Model.fromMoc = (moc: unknown) => {
    const model = original(moc)
    aliasDrawableRenderOrders(model)
    return model
  }
  patchedModels.add(Model)
}
