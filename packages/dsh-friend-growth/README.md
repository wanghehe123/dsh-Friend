# @wishp3/dsh-friend-growth

人生故事流水线（outline → expand → reflect），草稿审阅后写入 `story.md` / `beliefs.md` / MEMORY.md「近期主题」。**不是** XP / 等级系统。

Host 半区挂 `GET /friend/growth` 配置页与生成/提交 API。不注册伴侣会话工具。

## 验证

- 单测：`export CI=true && pnpm exec vitest run packages/dsh-friend-growth/test`
- 手册：打开 `/friend/growth` → 生成 → 预览勾除 1 条 → 提交，确认 `characters/<slug>/story.md` 不含被勾除节拍。
- 真实模型全程 < 5 min、以及「问小时候的事」引用 story.md，需要 live dsh + 已接线的 `completePrompt`，CI 只走 mock。
