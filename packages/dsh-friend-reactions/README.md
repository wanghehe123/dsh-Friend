# @wish233/dsh-friend-reactions

工作陪伴：订阅非伴侣会话的 `session/event` 元数据，节流后映射为舞台指令。三档台词（仅动作 / 气泡 / 语音）。

Host 半区挂 `GET /friend/reactions`。不注册伴侣会话工具，也不读取用户文本或文件内容。

## 验证

- 单测：`export CI=true && pnpm exec vitest run packages/dsh-friend-reactions/test`
- 手册：编码会话连续完成 3 个 turn，只庆祝 1 次；免打扰时段内零反应；伴侣会话不自反。
- 舞台 Live2D 真正动起来需要把 stage 的 `push` 注入 `apply({ push })`，或在已加载 pet 的页面里跑本包 client 半区。CI 不断言真实舞台。
