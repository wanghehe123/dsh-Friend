export function renderMemoryBrowserPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>dsh-Friend 记忆</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; background: #0f172a; color: #e2e8f0; }
      main { display: grid; grid-template-columns: 16rem 1fr; min-height: 100vh; }
      aside, section { padding: 1rem; }
      aside { border-right: 1px solid #334155; }
      h1 { font-size: 1.1rem; margin: 0 0 1rem; }
      button, input { font: inherit; }
      input[type="search"], textarea { width: 100%; background: #1e293b; color: inherit; border: 1px solid #475569; border-radius: .4rem; padding: .4rem .5rem; }
      textarea { min-height: 22rem; }
      ul { list-style: none; padding: 0; margin: 0; }
      li button { background: none; border: 0; color: #93c5fd; cursor: pointer; text-align: left; }
      .toolbar { display: flex; gap: .5rem; margin: .75rem 0; flex-wrap: wrap; }
      .hits { white-space: pre-wrap; background: #1e293b; padding: .75rem; border-radius: .5rem; }
      .status { color: #94a3b8; min-height: 1.4rem; }
    </style>
  </head>
  <body>
    <main>
      <aside>
        <h1>记忆文件</h1>
        <ul id="tree"></ul>
      </aside>
      <section>
        <div class="toolbar">
          <input id="search" type="search" placeholder="搜索记忆">
          <button type="button" id="run-search">搜索</button>
          <button type="button" id="save">保存</button>
          <button type="button" id="distill">立即归纳</button>
        </div>
        <p class="status" id="status"></p>
        <textarea id="editor" spellcheck="false"></textarea>
        <pre class="hits" id="hits" hidden></pre>
      </section>
    </main>
    <script>
      const tree = document.getElementById('tree');
      const editor = document.getElementById('editor');
      const status = document.getElementById('status');
      const hits = document.getElementById('hits');
      let currentPath = '';

      const setStatus = (text) => { status.textContent = text; };

      const loadTree = async () => {
        const response = await fetch('/friend/memory/tree');
        const body = await response.json();
        tree.replaceChildren();
        for (const file of body.files || []) {
          const item = document.createElement('li');
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = file;
          button.dataset.path = file;
          button.addEventListener('click', () => openFile(file));
          item.appendChild(button);
          tree.appendChild(item);
        }
      };

      const openFile = async (path) => {
        currentPath = path;
        const response = await fetch('/friend/memory/file?path=' + encodeURIComponent(path));
        const body = await response.json();
        editor.value = body.text || '';
        hits.hidden = true;
        setStatus(path);
      };

      document.getElementById('save').addEventListener('click', async () => {
        if (!currentPath) return;
        const response = await fetch('/friend/memory/file', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: currentPath, text: editor.value }),
        });
        const body = await response.json();
        setStatus(body.ok ? '已保存 ' + currentPath : (body.error || '保存失败'));
      });

      document.getElementById('run-search').addEventListener('click', async () => {
        const query = document.getElementById('search').value;
        const response = await fetch('/friend/memory/search?q=' + encodeURIComponent(query));
        const body = await response.json();
        hits.hidden = false;
        hits.textContent = (body.hits || []).map((hit) => hit.path + ':' + hit.line + '\\n' + hit.snippet).join('\\n\\n');
        setStatus('命中 ' + (body.hits || []).length + ' 条');
      });

      document.getElementById('distill').addEventListener('click', async () => {
        const response = await fetch('/friend/memory/distill', { method: 'POST' });
        const body = await response.json();
        setStatus(body.status === 'ok' ? '归纳完成' : ('归纳未写入：' + (body.reason || '')));
        if (currentPath) await openFile(currentPath);
      });

      loadTree();
    </script>
  </body>
</html>`
}

export function renderSearchHits(
  hits: ReadonlyArray<{ path: string; line: number; snippet: string; score: number }>,
): string {
  if (hits.length === 0) {
    return '（无命中）'
  }
  return hits
    .map((hit) => `${hit.path}:${hit.line}  (${hit.score})\n${hit.snippet}`)
    .join('\n\n')
}
