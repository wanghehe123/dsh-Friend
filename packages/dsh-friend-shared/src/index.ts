/**
 * Host half of `@wishp3/dsh-friend-shared`.
 *
 * Import from `@wishp3/dsh-friend-shared` (the `.` export). Node-only: the
 * graph includes `node:os` / `node:path` / `node:http` and dsh host adapters.
 * Re-exports the platform-neutral `./universal` barrel via `dsh-compat`.
 *
 * Never import this from a client-half module — Node builtins would land in
 * the `__ModuleLoader__` factory and the isolated loader table will throw.
 *
 * @see `./universal.ts` — constants and pure helpers safe on both halves
 * @see `./client.ts` — `./client` export (classic-script ModuleLoader payload)
 */
export * from './dsh-compat.ts'
export * from './friend-paths.ts'
export * from './model-select.ts'
export * from './plugin-mount.ts'
export {
  createStrictCordisCtx,
  type CreateStrictCordisCtxOptions,
  type StrictCordisCtxValues,
} from './strict-cordis-ctx.ts'

import { logPluginMount } from './plugin-mount.ts'

export const name = '@wishp3/dsh-friend-shared'

export function apply(_ctx: unknown): void {
  // TODO: host-half implementation beyond the compat seam
  logPluginMount(name)
}
