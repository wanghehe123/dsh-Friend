/** dsh token aliases with fallbacks so the overlay still paints outside the shell. */
export const FRIEND_SETTINGS_STYLE_ID = 'dsh-friend-settings-overlay'

export const FRIEND_SETTINGS_CSS = `
.dsh-friend-card,
.dsh-friend-overlay {
  color: var(--dsw-fg, #e8eaed);
  font: 13px/1.45 ui-sans-serif, system-ui, sans-serif;
}
.dsh-friend-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 12px;
}
.dsh-friend-card h2,
.dsh-friend-overlay h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.dsh-friend-muted {
  color: var(--dsw-muted, #8b919c);
}
.dsh-friend-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.dsh-friend-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dsh-friend-field input,
.dsh-friend-field select,
.dsh-friend-actions button,
.dsh-friend-nav button,
.dsh-friend-overlay button {
  background: var(--dsw-bg-elevated, #1a1d24);
  color: inherit;
  border: 1px solid var(--dsw-border, #2a2f3a);
  border-radius: 8px;
  padding: 6px 10px;
}
.dsh-friend-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.dsh-friend-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  background: color-mix(in srgb, var(--dsw-bg, #0f1115) 92%, black);
}
.dsh-friend-nav {
  width: 220px;
  padding: 16px 12px;
  border-right: 1px solid var(--dsw-border, #2a2f3a);
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
}
.dsh-friend-nav button[data-active="true"] {
  border-color: var(--dsw-accent, #5b8def);
}
.dsh-friend-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.dsh-friend-main header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--dsw-border, #2a2f3a);
}
.dsh-friend-pane {
  padding: 20px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.dsh-friend-hotkey {
  display: flex;
  gap: 8px;
  align-items: center;
}
.dsh-friend-hotkey input {
  flex: 1;
}
.dsh-friend-field input[type="range"] {
  padding: 0;
  border: none;
  background: transparent;
}
`

export function ensureFriendSettingsStyles(documentLike: {
  getElementById(id: string): { id: string } | null
  createElement(tag: string): { id: string; textContent: string }
  head: { appendChild(node: unknown): void }
}): void {
  if (documentLike.getElementById(FRIEND_SETTINGS_STYLE_ID) !== null) {
    return
  }
  const style = documentLike.createElement('style')
  style.id = FRIEND_SETTINGS_STYLE_ID
  style.textContent = FRIEND_SETTINGS_CSS
  documentLike.head.appendChild(style)
}
