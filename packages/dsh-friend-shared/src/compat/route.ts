import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'

/**
 * The smallest host surface required to own an HTTP route.
 *
 * This deliberately avoids exposing the whole evolving Cordis Context to
 * feature packages. A real DSH `Context` structurally satisfies this shape.
 */
export interface FriendRouteContext {
  webServer: Pick<WebServer, 'register'>
  effect(
    execute: () => (() => void | Promise<void>),
    label?: string,
  ): () => void | Promise<void>
}

function assertRoutePath(path: string): void {
  if (path.endsWith('/') && path !== '/') {
    throw new Error(`dsh-friend: route path must not end with "/": ${path}`)
  }
}

/**
 * Register an HTTP route on the official webserver and bind its disposer to
 * the calling plugin fiber.
 *
 * Official: `ctx.webServer.register(route)` (`@deepseek-ai/dsh-host-webserver`).
 * Real shape measured on rc.6, source: `dsh-friend:shape-diag stage ctx.webServer`:
 * `WebServer.register#1` on the prototype.
 * The returned disposer only removes the table entry; `ctx.effect` (Cordis)
 * is required so the route unloads with the plugin. Routes are not method-
 * specific — `WebRoute.path` is an exact/prefix literal, not Express `:param`.
 *
 * Replacement: if `register` is renamed or stops returning a disposer, adapt
 * this one call site; do not steal `registerFallback` (SPA already owns it).
 */
export function registerRoute(ctx: FriendRouteContext, route: WebRoute): () => void | Promise<void> {
  assertRoutePath(route.path)
  return ctx.effect(
    () => ctx.webServer.register(route),
    `dsh-friend: ${route.kind} ${route.path}`,
  )
}
