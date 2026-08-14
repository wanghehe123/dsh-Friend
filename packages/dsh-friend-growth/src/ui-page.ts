export function renderGrowthPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>dsh-Friend 成长</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; background: #0f172a; color: #e2e8f0; }
      main { max-width: 52rem; margin: 0 auto; padding: 1.25rem; }
      h1 { font-size: 1.2rem; }
      .toolbar, .prefs { display: flex; gap: .5rem; flex-wrap: wrap; margin: .75rem 0; align-items: center; }
      button, input { font: inherit; }
      input { background: #1e293b; color: inherit; border: 1px solid #475569; border-radius: .4rem; padding: .4rem .5rem; }
      button { background: #1e293b; color: inherit; border: 1px solid #475569; border-radius: .4rem; padding: .4rem .7rem; cursor: pointer; }
      button:hover { border-color: #38bdf8; }
      progress { width: 100%; }
      .status { color: #94a3b8; min-height: 1.4rem; }
      ul { list-style: none; padding: 0; }
      li { padding: .4rem 0; border-bottom: 1px solid #1e293b; }
      label { display: flex; gap: .5rem; align-items: flex-start; }
    </style>
  </head>
  <body>
    <main>
      <h1>人生故事</h1>
      <p class="status" id="status">尚未生成</p>
      <progress id="bar" max="100" value="0"></progress>
      <div class="prefs">
        <label>目标语言 <input id="language" value="中文"></label>
        <label>模型 override <input id="model" placeholder="继承 dsh 默认"></label>
      </div>
      <div class="toolbar">
        <button type="button" id="generate">生成</button>
        <button type="button" id="continue">续写</button>
        <button type="button" id="commit">提交</button>
      </div>
      <ul id="beats"></ul>
    </main>
    <script>
      const status = document.getElementById('status');
      const bar = document.getElementById('bar');
      const beats = document.getElementById('beats');
      const language = document.getElementById('language');
      const model = document.getElementById('model');
      let excluded = new Set();

      const applyProgress = (snapshot) => {
        if (!snapshot) return;
        bar.value = typeof snapshot.percent === 'number' ? snapshot.percent : 0;
        status.textContent = (snapshot.phase || '') + ' ' + (snapshot.message || '') + ' ' + (snapshot.percent || 0) + '%';
      };

      const loadDraft = async () => {
        const response = await fetch('/friend/growth/draft');
        const body = await response.json();
        excluded = new Set(body.excluded || []);
        if (body.preferences) {
          if (body.preferences.language) language.value = body.preferences.language;
          if (typeof body.preferences.model === 'string') model.value = body.preferences.model;
        }
        applyProgress(body.progress);
        beats.replaceChildren();
        for (const beat of body.beats || []) {
          const item = document.createElement('li');
          const label = document.createElement('label');
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = !excluded.has(beat.id);
          box.addEventListener('change', async () => {
            if (box.checked) excluded.delete(beat.id); else excluded.add(beat.id);
            await fetch('/friend/growth/exclude', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ids: [...excluded] }),
            });
          });
          label.appendChild(box);
          label.appendChild(document.createTextNode((beat.age != null ? '（' + beat.age + '岁）' : '') + beat.title + ' · ' + beat.kind));
          item.appendChild(label);
          beats.appendChild(item);
        }
      };

      const run = async (continueLife) => {
        status.textContent = '生成中…';
        const response = await fetch('/friend/growth/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            continue: continueLife,
            language: language.value,
            model: model.value || undefined,
          }),
        });
        const body = await response.json();
        if (!response.ok) {
          status.textContent = body.error || '生成失败';
          return;
        }
        await loadDraft();
      };

      document.getElementById('generate').addEventListener('click', () => run(false));
      document.getElementById('continue').addEventListener('click', () => run(true));
      document.getElementById('commit').addEventListener('click', async () => {
        const response = await fetch('/friend/growth/commit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ excludedIds: [...excluded] }),
        });
        const body = await response.json();
        status.textContent = response.ok ? '已提交 ' + (body.committed || []).length + ' 条' : (body.error || '提交失败');
        await loadDraft();
      });

      const events = new EventSource('/friend/growth/events');
      events.addEventListener('open', async () => {
        try {
          const response = await fetch('/friend/growth/progress');
          if (response.ok) applyProgress(await response.json());
        } catch {}
        await loadDraft();
      });
      events.addEventListener('asset-progress', (event) => {
        try {
          const parsed = JSON.parse(event.data);
          applyProgress(parsed && parsed.payload ? parsed.payload : parsed);
        } catch {}
      });
    </script>
  </body>
</html>`
}
