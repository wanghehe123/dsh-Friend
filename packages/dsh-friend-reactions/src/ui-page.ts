export function renderReactionsPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>dsh-Friend 工作陪伴</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; background: #0f172a; color: #e2e8f0; }
      main { max-width: 40rem; margin: 0 auto; padding: 1.25rem; }
      label { display: block; margin: .6rem 0; }
      select, input { font: inherit; background: #1e293b; color: inherit; border: 1px solid #475569; border-radius: .4rem; padding: .35rem .5rem; }
      pre { background: #1e293b; padding: .75rem; border-radius: .5rem; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <main>
      <h1>工作陪伴</h1>
      <p>观察编码会话元数据，映射为舞台小表演。伴侣会话不会触发。</p>
      <label>档位
        <select id="level">
          <option value="action">仅动作</option>
          <option value="bubble">动作+气泡</option>
          <option value="voice">动作+语音</option>
        </select>
      </label>
      <pre id="latest">尚无反应</pre>
    </main>
    <script>
      const latest = document.getElementById('latest');
      const level = document.getElementById('level');
      const apply = (snapshot) => {
        if (!snapshot) return;
        latest.textContent = JSON.stringify(snapshot, null, 2);
      };
      const events = new EventSource('/friend/reactions/events');
      events.addEventListener('open', async () => {
        try {
          const response = await fetch('/friend/reactions/latest');
          if (response.ok) apply(await response.json());
        } catch {}
      });
      events.addEventListener('reaction', (event) => {
        try {
          const parsed = JSON.parse(event.data);
          apply(parsed && parsed.payload ? parsed.payload : parsed);
        } catch {}
      });
      level.addEventListener('change', async () => {
        await fetch('/friend/reactions/level', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ level: level.value }),
        });
      });
    </script>
  </body>
</html>`
}
