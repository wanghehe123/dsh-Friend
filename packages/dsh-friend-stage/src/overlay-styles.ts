/**
 * Float chrome stylesheet. Injected once into `document.head` the same way
 * settings injects `#dsh-friend-settings-overlay` — never inlined per handle.
 * Released when the overlay disposes so a remount does not leak a second tag.
 */
export const FRIEND_OVERLAY_STYLE_ID = 'dsh-friend-float-chrome'

export type OverlayStyleNode = {
  id: string
  textContent: string
  remove?(): void
}

export type OverlayStyleDocument = {
  getElementById(id: string): OverlayStyleNode | null
  createElement(tag: string): OverlayStyleNode
  head: { appendChild(node: OverlayStyleNode): void }
}

/**
 * dsh dark tokens with the same fallbacks as the settings overlay, so the
 * float chrome still paints outside the shell. Host / chrome / iframe stay
 * transparent so `data-transparent` pet embeds are not covered by a box.
 */
export const FRIEND_OVERLAY_CSS = `
#dsh-friend-float {
  box-sizing: border-box;
  background: transparent;
}
.dsh-friend-float-chrome {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  background: transparent;
}
.dsh-friend-float-chrome iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  pointer-events: auto;
}
.dsh-friend-float-drag {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 22px;
  z-index: 2;
  box-sizing: border-box;
  pointer-events: auto;
  cursor: grab;
  background: color-mix(in srgb, var(--dsw-bg-elevated, #1a1d24) 72%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--dsw-border, #2a2f3a) 80%, transparent);
}
.dsh-friend-float-drag:active {
  cursor: grabbing;
}
.dsh-friend-float-drag::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 28px;
  height: 3px;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: var(--dsw-muted, #8b919c);
  opacity: 0.7;
  pointer-events: none;
}
.dsh-friend-float-chrome [data-resize] {
  position: absolute;
  width: 16px;
  height: 16px;
  z-index: 3;
  box-sizing: border-box;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 2px;
  background: transparent;
  pointer-events: auto;
  appearance: none;
  -webkit-appearance: none;
}
.dsh-friend-float-chrome [data-resize="top-left"] {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}
.dsh-friend-float-chrome [data-resize="top-right"] {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}
.dsh-friend-float-chrome [data-resize="bottom-left"] {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
}
.dsh-friend-float-chrome [data-resize="bottom-right"] {
  bottom: 0;
  right: 0;
  cursor: nwse-resize;
}
.dsh-friend-float-chrome [data-resize]:hover {
  background: color-mix(in srgb, var(--dsw-accent, #5b8def) 35%, transparent);
}
.dsh-friend-float-chrome [data-friend-bubble],
.dsh-friend-float-chrome [data-friend-menu] {
  position: absolute;
  z-index: 4;
  pointer-events: auto;
  color: var(--dsw-fg, #e8eaed);
  font: 13px/1.45 ui-sans-serif, system-ui, sans-serif;
}
`

export function isOverlayStyleDocument(value: object): value is OverlayStyleDocument {
  if (!('getElementById' in value) || !('head' in value) || !('createElement' in value)) {
    return false
  }
  return typeof value.getElementById === 'function'
    && value.head !== undefined
    && typeof value.createElement === 'function'
}

export function ensureFriendOverlayStyles(documentLike: OverlayStyleDocument): void {
  if (documentLike.getElementById(FRIEND_OVERLAY_STYLE_ID) !== null) {
    return
  }
  const style = documentLike.createElement('style')
  style.id = FRIEND_OVERLAY_STYLE_ID
  style.textContent = FRIEND_OVERLAY_CSS
  documentLike.head.appendChild(style)
}

export function releaseFriendOverlayStyles(documentLike: OverlayStyleDocument): void {
  const node = documentLike.getElementById(FRIEND_OVERLAY_STYLE_ID)
  if (node === null) return
  if (typeof node.remove === 'function') {
    node.remove()
  }
}
