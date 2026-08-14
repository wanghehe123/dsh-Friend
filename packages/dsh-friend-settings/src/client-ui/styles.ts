/** Official dsh Settings tokens, with fallbacks so the dialog still paints outside the shell. */
export const FRIEND_SETTINGS_STYLE_ID = 'dsh-friend-settings-overlay'

/** Must sit above the float chrome (`FLOAT_Z_INDEX` = 2147483000). */
export const FRIEND_SETTINGS_OVERLAY_Z_INDEX = 2_147_483_646

export const FRIEND_SETTINGS_CSS = `
.dsh-friend-card,
.dsh-friend-overlay,
.dsh-friend-panel,
.dsh-friend-general-item {
  color: var(--dsw-alias-label-primary, #f5f5f6);
  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif);
  font-size: 14px;
  line-height: 22px;
}
.dsh-friend-card {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0 0 8px;
}
.dsh-friend-card[data-collapsible="true"] {
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
  background: var(--dsw-alias-bg-layer-3, #353638);
  border-radius: 12px;
  list-style: none;
  transition: border-color .16s, background .16s;
}
.dsh-friend-card[data-collapsible="true"]:hover {
  border-color: var(--dsw-alias-label-dimmed, #6b6d73);
}
.dsh-friend-card[data-collapsible="true"][data-open="true"] {
  background: var(--dsw-alias-bg-layer-2, #2c2c2e);
  border-color: var(--dsw-alias-label-dimmed, #6b6d73);
}
.dsh-friend-card-header {
  appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-friend-card-header:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #5b8def);
  outline-offset: -2px;
}
.dsh-friend-card-head-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 4px;
  min-width: 0;
}
.dsh-friend-card-name {
  color: var(--dsw-alias-label-primary, #f5f5f6);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}
.dsh-friend-card-desc {
  color: var(--dsw-alias-label-tertiary, #9a9da3);
  font-size: 13px;
  line-height: 1.5;
}
.dsh-friend-card-pending {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-module-platform, #2c2c2e);
  color: var(--dsw-alias-label-secondary, #c8c9cc);
  font-size: 11px;
  font-weight: 500;
  line-height: 17px;
  white-space: nowrap;
}
.dsh-friend-card-chevron {
  flex: none;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  border-right: 1.5px solid var(--dsw-alias-label-tertiary, #9a9da3);
  border-bottom: 1.5px solid var(--dsw-alias-label-tertiary, #9a9da3);
  transform: rotate(45deg);
  transition: transform .16s;
}
.dsh-friend-card-chevron-open {
  transform: rotate(225deg);
}
.dsh-friend-card[data-collapsible="true"] .dsh-friend-card-body {
  margin: 0 16px;
  padding-bottom: 8px;
  border-top: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
}
.dsh-friend-card-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0 16px;
}
.dsh-friend-card h2,
.dsh-friend-pane-title {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
}
.dsh-friend-muted,
.dsh-friend-row-desc {
  color: var(--dsw-alias-label-tertiary, #9a9da3);
  font-size: 12px;
  line-height: 18px;
}
.dsh-friend-row,
.dsh-friend-general-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 16px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
}
.dsh-friend-row:last-of-type,
.dsh-friend-card > .dsh-friend-row:last-of-type {
  border-bottom: none;
}
.dsh-friend-row-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding-right: 24px;
}
.dsh-friend-row-title {
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary, #f5f5f6);
}
.dsh-friend-control,
.dsh-friend-row input:not([type="checkbox"]):not([type="range"]),
.dsh-friend-row select,
.dsh-friend-field input,
.dsh-friend-field select,
.dsh-friend-field textarea {
  box-sizing: border-box;
  min-width: 160px;
  max-width: 240px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3, #353638);
  color: inherit;
  font: inherit;
  font-size: 13px;
}
.dsh-friend-field textarea,
.dsh-friend-step textarea {
  height: auto;
  min-height: 72px;
  max-width: none;
  width: 100%;
  padding: 8px 12px;
  resize: vertical;
}
.dsh-friend-field input[type="file"] {
  height: auto;
  max-width: none;
  padding: 6px 0;
  border: none;
  background: transparent;
}
.dsh-friend-row input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--dsw-alias-brand-primary, #f5f5f6);
}
.dsh-friend-row input[type="range"] {
  width: 160px;
  padding: 0;
  border: none;
  background: transparent;
}
.dsh-friend-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 0;
}
.dsh-friend-field > span {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #9a9da3);
}
.dsh-friend-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  padding: 16px 0 4px;
}
.dsh-friend-actions button,
.dsh-friend-pill,
.dsh-friend-step button,
.dsh-friend-hotkey button {
  height: 36px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 18px;
  background: var(--dsw-alias-bg-module-platform, #353638);
  color: inherit;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
}
.dsh-friend-actions button[data-action="commit"],
.dsh-friend-actions button[data-action="generate"],
.dsh-friend-actions button[data-action="commit-growth"],
.dsh-friend-btn-primary {
  background: var(--dsw-alias-button-primary-fill, #f5f5f6);
  color: var(--dsw-alias-label-primary-foreground, #151517);
}
.dsh-friend-actions button:disabled,
.dsh-friend-step button:disabled {
  opacity: 0.4;
  cursor: default;
}
.dsh-friend-test-status {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #9a9da3);
  text-align: right;
}
.dsh-friend-test-status[data-ok="true"] {
  color: #86efac;
}
.dsh-friend-test-status[data-ok="false"] {
  color: #fecaca;
}
.dsh-friend-overlay {
  position: fixed;
  inset: 0;
  z-index: ${FRIEND_SETTINGS_OVERLAY_Z_INDEX};
  display: flex;
  align-items: center;
  justify-content: center;
}
.dsh-friend-mask {
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.5));
  backdrop-filter: var(--dsw-mask-blur, blur(2px));
}
.dsh-friend-panel {
  position: relative;
  z-index: 1;
  display: flex;
  width: 800px;
  max-width: calc(100vw - 48px);
  height: min(800px, 100vh - 48px);
  overflow: hidden;
  border-radius: 24px;
  background: var(--dsw-alias-bg-layer-2, #2c2c2e);
  box-shadow: var(--dsw-shadow-lv3, 0 0 1px rgba(0, 0, 0, 0.2), 0 12px 32px rgba(0, 0, 0, 0.08));
}
.dsh-friend-nav {
  width: 188px;
  flex-shrink: 0;
  padding: 22px 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow: auto;
}
.dsh-friend-nav-title {
  padding: 0 12px;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
}
.dsh-friend-nav-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dsh-friend-nav button {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 9px 16px 9px 12px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  text-align: left;
  cursor: pointer;
}
.dsh-friend-nav button:hover {
  background: var(--dsw-specific-sidebar-nav-item-hover, #2c2c2e);
}
.dsh-friend-nav button[data-active="true"] {
  background: var(--dsw-specific-sidebar-nav-item-active, #3a3a3c);
}
.dsh-friend-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.dsh-friend-main header {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  height: 54px;
  padding: 20px 14px 8px 10px;
}
.dsh-friend-close {
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 28px;
  background: transparent;
  color: inherit;
  font-size: 18px;
  line-height: 28px;
  cursor: pointer;
}
.dsh-friend-close:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
}
.dsh-friend-pane {
  flex: 1;
  padding: 0 24px 24px;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
.dsh-friend-hotkey {
  display: flex;
  gap: 8px;
  align-items: center;
}
.dsh-friend-hotkey input {
  flex: 1;
  max-width: 160px;
}
.dsh-friend-general-item {
  width: 100%;
  margin: 0;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
  cursor: pointer;
  text-align: left;
}
.dsh-friend-step {
  margin-top: 16px;
  padding: 14px 16px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3, #353638);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-friend-step-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
}
.dsh-friend-step-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}
.dsh-friend-progress {
  width: 100%;
  height: 6px;
  border: none;
  border-radius: 6px;
  overflow: hidden;
  background: var(--dsw-alias-bg-module-platform, #2c2c2e);
}
.dsh-friend-beat {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
}
.dsh-friend-beat:last-child {
  border-bottom: none;
}
.dsh-friend-node {
  display: grid;
  grid-template-columns: 72px 72px 1fr 1fr;
  gap: 8px;
  padding: 8px 0;
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
