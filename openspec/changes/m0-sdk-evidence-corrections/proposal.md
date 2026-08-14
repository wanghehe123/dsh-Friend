# 用 M0 一手证据校正第一版 spec

## Why

第一版 spec 与 `docs/migration-plan.md` 是在**没有读过 dsh SDK 源码**的情况下写的，若干 API 细节属于推测。M0 探路（`docs/m0-findings.md`，工作项 W-M0-6）对本机安装的 `@deepseek-ai/*@0.1.0-rc.6` 与 dsh CLI 做了带 `文件:行号` 引证的调研，推翻了其中五处；M0 实现（W-M0-2/3/5）又在真实 `dsh web` 上验证了 client 加载契约。

这些偏差全部会影响 M1 起的实现代码（命名空间会直接抛异常、槽位名不存在、路由参数写法无效），必须先把契约改对再往下做。

## What Changes

五项按证据校正，逐条列出「原 spec 说法 → 事实 → 采用方案」：

1. **设置命名空间不能带点号**。`settingsNamespace()` 的正则是 `/^[a-z][a-z0-9-]*$/`（`dsh-settings/lib/index.js:81`），spec 里的 `friend.core.language` / `friend.persona.chatModel` / `friend.memory.summarizeModel` / `friend.growth.model` 会在运行时抛错。改为 kebab 命名空间（`friend-core`、`friend-persona`…）+ 空间内字段名。
2. **`settings.plugin.item` 槽位不存在**。rc.6 的设置域槽位是 `settings.section`（每功能一页）、`settings.general.item`（通用区一行）、`settings.plugins.tab`（插件区标签页）。父卡片改挂 `settings.section`。
3. **没有整页/路由级 client 槽位**。唯一接近的 `root` 被 AppFrame 占用且官方注释明令禁止注册。配置中心十分区改为**自建全屏覆盖层**（hash 路由），入口从设置分区进。
4. **HTTP 路由没有 `:param` 匹配**。`WebRoute` 只有 `exact` / `prefix` 两种 kind（`dsh-host-webserver/lib/types/index.d.ts:19`），`GET /friend/tts/audio/:id` 无法按字面注册。改为 `prefix: /friend/tts/audio` 后在 handler 内解析 id。
5. **Agent 预设不是函数注册，而是目录发现**。rc.6 无 `registerPreset`；预设 = 含 `agent.cordis.yml` 的目录，由 `ctx.agentPresets` 扫描 roots 发现，工具白名单只能在预设常驻 scope 上 `tools.restrict`（host 全局调用会抛）。预设相关要求改为描述这一投放+断言机制。

另外**确认**（不改，仅记录证据）：host→client 无官方插件推送通道，自建 SSE `GET /friend/events` 成立，且 `WebRoute.handler` 注释明文支持挂住响应；client 半区必须产出 `window.__ModuleLoader__.load({id, factory})` 的 CJS 包装（`dsh-client-modules` 是 loader 本体，裸 ESM 不会被注册）。

受影响能力域：`settings-ui`、`persona`、`voice-output`、`stage`、`distribution`。

## Non-goals

- 不改任何产品决策（零配置、Markdown 记忆、桌面壳等一律不动）。
- 不重写 `docs/migration-plan.md` 的设计论述，只在其与 SDK 冲突处以本 change 为准。
- 不引入新能力域，不调整里程碑范围。
- 不处理尚无证据的推测（例如未安装的 `dsh-client-ui-layout` 若将来提供 `shell.overlay`，另行提案）。

## Impact

- 受影响工作项：W-M8-1（父卡片槽位）、W-M8-2（配置中心形态）、W-M8-3 与全部含配置项的工作项（命名空间）、W-M2-5（音频路由）、W-M1-3/W-M1-4（预设与分区 scope）。
- 代码影响面：M0 已按正确形态落地（`dsh-friend-shared` 的 compat 命名空间常量表即是本 change 第 1 条的实现），M1 起按修订后的 spec 实现即可。
- 风险：低。全部为「把错的写对」，无行为回退。
