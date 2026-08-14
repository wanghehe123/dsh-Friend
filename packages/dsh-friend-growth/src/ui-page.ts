import { GROWTH_PAGE_CSS } from './ui-styles.ts'

export function renderGrowthPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>dsh-Friend 成长</title>
    <style>${GROWTH_PAGE_CSS}</style>
  </head>
  <body>
    <main>
      <h1>成长</h1>
      <p class="intro">给伴侣一段自己走过的人生：先填基础设定和成长节点，让模型模拟完整经历，再逐条审核后才写入长期记忆。</p>
      <section class="step" data-growth-step="1">
        <h2>1. 基础设定</h2>
        <div class="grid">
          <label>出生年份 <input id="birthYear" type="number"></label>
          <label>当前年龄 <input id="currentAge" type="number"></label>
        </div>
        <label>世界设定 <textarea id="worldSetting"></textarea></label>
        <label>基础属性（出身 / 家庭 / 天赋 / 性情） <textarea id="baseAttributes"></textarea></label>
        <div class="grid">
          <label>目标语言 <input id="language" value="中文"></label>
          <label>模型 override <input id="model" placeholder="继承 dsh 默认"></label>
        </div>
      </section>
      <section class="step" data-growth-step="2">
        <h2>2. 模拟人生</h2>
        <p class="status" id="status">尚未生成</p>
        <progress id="bar" max="100" value="0"></progress>
        <div class="actions">
          <button type="button" id="continue">续写</button>
          <button type="button" class="primary" id="generate">开始模拟人生</button>
        </div>
      </section>
      <section class="step" data-growth-step="3">
        <h2>3. 草稿审核</h2>
        <ul id="beats"></ul>
        <div class="actions">
          <button type="button" class="primary" id="commit">写入记忆库</button>
        </div>
      </section>
    </main>
    <script>
      const status = document.getElementById('status');
      const bar = document.getElementById('bar');
      const beats = document.getElementById('beats');
      const language = document.getElementById('language');
      const model = document.getElementById('model');
      const birthYear = document.getElementById('birthYear');
      const currentAge = document.getElementById('currentAge');
      const worldSetting = document.getElementById('worldSetting');
      const baseAttributes = document.getElementById('baseAttributes');
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
        if (body.profile) {
          if (body.profile.birthYear != null) birthYear.value = body.profile.birthYear;
          if (body.profile.currentAge != null) currentAge.value = body.profile.currentAge;
          if (body.profile.worldSetting) worldSetting.value = body.profile.worldSetting;
          if (body.profile.baseAttributes) baseAttributes.value = body.profile.baseAttributes;
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
            birthYear: birthYear.value === '' ? undefined : Number(birthYear.value),
            currentAge: currentAge.value === '' ? undefined : Number(currentAge.value),
            worldSetting: worldSetting.value,
            baseAttributes: baseAttributes.value,
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
