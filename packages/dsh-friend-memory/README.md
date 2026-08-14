# @wish233/dsh-friend-memory

Markdown 记忆存储、记忆工具、自动小结、夜间归纳。不依赖 embedding。

## 落盘布局（相对 friend 数据根）

```
characters/<slug>/MEMORY.md
characters/<slug>/MEMORY.md.bak.1 … bak.7
characters/<slug>/memory/YYYY-MM-DD.md
characters/<slug>/memory/archive/YYYY-MM/
characters/<slug>/memory/imported/YYYY-MM-DD.md
characters/<slug>/story.md
user/USER.md
```

`MEMORY.md` 固定四分节：关于用户 / 重要事实 / 近期主题 / 待办与约定。

## 角色分流

- host `apply()`：挂载 `/friend/memory*` 路由、自动小结、04:00 蒸馏。**不**注册工具。
- companion-preset `apply()`：注册 `memory_append` / `memory_search` / `memory_get` 与 `friend:memory` 提示词分区。

伴侣预设 `agent.cordis.yml` 需要增加一行 `dsh-friend-memory` + `role: companion-preset` 后，真实会话才能看到工具（本包不能改 persona）。

## 验证

```bash
export CI=true
pnpm exec vitest run packages/dsh-friend-memory
```

手工：打开 `/friend/memory`，改一条 MEMORY.md 并保存，再用 `memory_get` / 搜索框核对。
