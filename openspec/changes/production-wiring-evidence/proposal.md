# 生产接线纠偏：seam 有绿灯、生产路径是死的

## Why

一次独立审计（`VERDICT: FAIL`）加一次系统性只读排查，暴露出**同一类缺陷连续出现七例**。共同形态是：

> 代码留了一个可注入的 seam（`config.xxx ?? 默认`、`options.yyy`、导出的工厂函数），**测试注入 seam 拿到了绿色**，而生产路径上那个默认分支是死的、或根本到不了。

七例（全部有真实环境或真实 `.d.ts` 证据）：

| # | 东西 | 生产真实行为 | 测试为什么绿 |
|---|---|---|---|
| 1 | TTS 全链路 | host 合成好落进 `cache/tts/`，真实浏览器整页零次 `/friend/tts/*` 请求；无包 import tts，`getFriendTtsClient()` 零调用方 | 两半各自单测充分，从不检查两半之间有没有连线 |
| 2 | `own()` 辅助函数 | 用 `hasOwnProperty` 探测 Cordis 服务，而 Cordis 走 Proxy get trap → **恒 `undefined`**，19 处生产路径静默死掉，`POST /friend/stage/chat` 实测 503 | 测试用**对象字面量**当 ctx（`hasOwnProperty` 天然 true），还把 `undefined` 分支命名为 "Cordis-safe" 写进断言 |
| 3 | `bindSettingsHost` | 全仓生产代码只有一处调用，被 `if (config.coreSchema !== undefined)` 包着，生产**从不传** → 所有设置命名空间从未注册，实测日志 `settings namespace "friend-core" is not registered` | 测试传 `coreSchema` |
| 4 | `dsh-friend:lipsync` | 只有监听方，全仓零 dispatch；`audio-player.onEnergy` 无人接线 | 监听侧单测充分 |
| 5 | `ctx.llm.stream()` | 全仓零调用；memory/growth 的 `inject` 里连 `llm` 都没有；生产走的是**抛错桩** `completePrompt` → 自动小结/夜间蒸馏/成长流水线在真实环境 100% 抛异常 | 测试注入 `config.completePrompt` |
| 6 | ASR 识别结果 | `client.ts` 不传 `onSend` → 终稿文本被 `?.()` **静默丢弃**；pet 页不传 `settingsScope` → 用户配的 engine/mode/hotkey/language 全部退回默认值 | 测试注入 `onSend` 与 `settingsScope` |
| 7 | reactions 事件链路 | `wrapContextEvents` 传 `args[0]`（`Session`），而 DSH 签名是 `(session, event)` → `observeRawEvent` 恒 `undefined`，**整包生产从未产出一个事件**；且 `WORK_EVENT_KINDS` 里 `tool-long`/`tool-error`/`plan-approved` 三个在 DSH 的 `SessionEventMap` 里**根本不存在** | 测试注入 `eventSource` seam 绕开唯一生产订阅路径；整个 reactions 测试目录**零处出现 `ctx.on`** |

第 2、3、5、6、7 例都还伴随**测试为 bug 背书**：断言写的是错误行为，或为不可达分支写正向断言，于是覆盖率与绿灯来自生产不可达的代码。

现有门禁挡不住这一类：`pnpm test` / `typecheck` / `aggregate --check` / `smoke`（host 挂载行 + 路由 200）/ `browser-smoke`（页面无 `Failed to load plugins` + boot graph 条目）在上述七例全部存在时**曾同时为绿**。boot graph 是服务端渲染的**计划**，不是客户端**执行结果**，更不是「执行完之后能不能用」。

## What Changes

- 新增「生产路径可达性」要求：seam 的默认分支必须是**生产真正走的那条**，且必须能工作
- 新增「测试假件与运行时同构」要求：禁止用对象字面量假 ctx 掩盖 Cordis 语义；服务必须经 Proxy get trap 暴露
- 新增「事实基准」要求：DSH 触点的签名、事件词表、服务形状一律以 `node_modules/@deepseek-ai/*` 的真实 `.d.ts` 与真实运行时诊断为准，不得照自己编的词表实现
- 新增「双向连接」要求：事件/路由/跨包依赖必须两端都有
- 修订 `distribution` 的门禁要求：明确 host 绿、boot graph 绿都不构成功能可用的证据
- **BREAKING**（对 `work-reactions`）：删除 `tool-long` / `plan-approved` 两个内部事件 kind——DSH 的 `tool/result` 不带耗时字段，`plan-approved` 事件不存在

## Impact

- 受影响能力：`distribution`、`work-reactions`、`voice-input`、`voice-output`、`memory`、`growth`、`settings-ui`、`stage`、`persona`
- 受影响工作项：W-M1-5、W-M1-6、W-M2-2、W-M2-4、W-M2-7、W-M2-8、W-M3-1、W-M3-2、W-M3-3、W-M3-6、W-M4-4、W-M4-5、W-M4-8、W-M5-5、W-M5-6、W-M5-8、W-M6-4、W-M7-1、W-M7-2、W-M7-3、W-M7-5、W-M7-6、W-M7-7、W-M8-3、W-M8-5
- 受影响代码：11 个包中的 9 个，以及 `apps/friend-shell/src/bridge.rs`

## 待拍板决策

### D1：`friend-core.muted` / `friend-stage.floatMuted` 保留为写穿别名还是删掉

静音原本有三个互不相通的字段，只有 `friend-tts.muted` 被真的读取。本轮把 `friend-tts.*` 定为唯一真源，另两个做成**写穿别名**（写入时一并更新，读取只认真源），理由是避免旧配置与旧文档立刻失效。

- **D1-A（现状）**：保留别名。代价是三个字段长期共存，后来者仍可能误读别名
- **D1-B**：删掉两个别名，旧配置里的值直接失效

### D2：growth 的 `role === 'companion-preset'` 分支删还是挂

两个 preset yml 都不挂 growth，该分支不可达且是空 no-op。

- **D2-A**：删掉死分支。伴侣会话里不提供成长工具
- **D2-B**：把 growth 挂进 preset yml，让伴侣会话能直接读成长状态

### D3：`toolLongMs` 设置项怎么处理

`tool-long` 已从事件词表删除（DSH 拿不到工具耗时），但 schema 与 UI 里还留着这个配置项。

- **D3-A（现状）**：保留 schema 项以免旧配置报错，UI 隐藏，注释写明不生效
- **D3-B**：从 schema 与 UI 一并删除

### D4：openai-compat 试听不能履约时是否继续静默回落 Edge

实测：UI 把 `provider: openai-compat` 送进 `POST /friend/tts/preview`，但响应 `providerId` 仍是 `edge`——host `speak()` 在无法履约时回落。用户会以为选中的 provider 生效了。

- **D4-A**：改成 fail-loud，让用户看到「凭据缺失/不可用，未回落」
- **D4-B（现状）**：继续回落，但在 UI 上显式标出「实际使用 edge」
