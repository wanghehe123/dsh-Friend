/** Same token set as the dsh Settings dialog so /friend/growth is not a second visual language. */
export const GROWTH_PAGE_STYLE_ID = 'dsh-friend-growth-page'

export const GROWTH_PAGE_CSS = `
:root { color-scheme: dark; }
html, body { margin: 0; min-height: 100%; }
body {
  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Helvetica, Arial, sans-serif);
  background: var(--dsw-alias-bg-base, #151517);
  color: var(--dsw-alias-label-primary, #f5f5f6);
}
main {
  width: min(800px, calc(100vw - 48px));
  margin: 24px auto;
  padding: 22px 24px 28px;
  border-radius: 24px;
  background: var(--dsw-alias-bg-layer-2, #2c2c2e);
  box-shadow: var(--dsw-shadow-lv3, 0 12px 32px rgba(0, 0, 0, 0.08));
}
h1 { margin: 0 0 8px; font-size: 16px; font-weight: 500; line-height: 24px; }
.intro, .status { margin: 0 0 16px; color: var(--dsw-alias-label-tertiary, #9a9da3); font-size: 12px; line-height: 18px; }
.step {
  margin-top: 16px;
  padding: 14px 16px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3, #353638);
}
.step h2 { margin: 0 0 10px; font-size: 15px; font-weight: 600; line-height: 22px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-tertiary, #9a9da3); }
input, textarea, button {
  font: inherit;
  color: var(--dsw-alias-label-primary, #f5f5f6);
}
input, textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #2c2c2e);
}
textarea { min-height: 72px; padding: 8px 12px; resize: vertical; }
.actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
button {
  height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: 18px;
  background: var(--dsw-alias-bg-module-platform, #353638);
  cursor: pointer;
}
button.primary {
  background: var(--dsw-alias-button-primary-fill, #f5f5f6);
  color: var(--dsw-alias-label-primary-foreground, #151517);
}
progress { width: 100%; height: 6px; }
ul { list-style: none; padding: 0; margin: 0; }
li { padding: 10px 0; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12)); }
li label { flex-direction: row; align-items: flex-start; gap: 8px; color: inherit; font-size: 14px; }
`
