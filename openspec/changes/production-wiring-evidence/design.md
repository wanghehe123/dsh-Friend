# 设计与证据：生产接线纠偏

## 1. 缺陷模式的解剖

七例的共同结构：

```ts
// 生产路径
const impl = config.impl ?? defaultImpl   // ← 生产走 defaultImpl
// 测试路径
apply(ctx, { impl: fakeImpl })            // ← 测试走 fakeImpl，绿
```

只要 `defaultImpl` 是抛错桩、空实现、或依赖一个生产上拿不到的东西，这套结构就会**同时**产出「测试全绿」与「生产不可用」。它比普通 bug 更难发现，因为覆盖率、类型检查、冒烟都不看这条边。

三种具体死法：

- **死法一：默认分支是桩。** `complete ?? (async () => { throw })`（memory `index.ts:292`、growth `index.ts:140`）
- **默认分支到达了但不能工作。** `wrapContextEvents(ctx)` 真的被调用了，但它按错的 arity 传值（reactions `index.ts:161-173`）
- **默认分支根本到不了。** `if (config.coreSchema !== undefined)` 包住唯一的注册调用（settings `index.ts:80`）

## 2. Cordis 语义与假件同构性

`node_modules/@deepseek-ai/cordis/src/reflect.ts`：

- `:144` 未 inject 的属性读取抛 `cannot get property "<prop>" without inject`
- `:136-166` 服务经 Proxy `get` trap 解析，**永远不是 own property**
- `:15-16`、`:233-234` `ctx.get(name)` 返回 `undefined | this[K]`（已声明但未提供时为 `undefined`）
- `registry.ts:105`、`fiber.ts:614-622` fiber 在全部 inject 到位前保持 `INACTIVE`，`apply()` 不会跑；所以 `apply()` 内读已声明服务是安全的

由此得出两条对假件的硬要求：

1. **服务必须经 get trap 暴露**，不能放成 own property——否则 `hasOwnProperty` 式探测在测试里能过、在生产里恒 false（第 2 例）
2. **假服务方法必须依赖 `this`**——否则解构后调用在测试里能过、在生产里抛 `this.write is not a function`

第二条来自真实诊断：`settings.update.call({})` 直接抛 `this.write is not a function`。`FileSettingsProvider` 的原型链是 `FileSettingsProvider → SettingsProvider → Service`，`SettingsProvider.update#3` 内部调 `this.write#4`。

## 3. 真实运行时形状 vs 类型定义

照类型定义写会错。真实诊断（隔离实例 stdout）：

```
ctx.agents            → AgentRegistry，protoMethods 含 create#1 / resume#1 / get#1，followup 不存在
agents.create() 返回  → { agent, dispose } 的普通对象，followup 不存在
agents.create().agent → ReactLoopAgent，followup#1 在这里
agents.get(id)        → ReactLoopAgent（直接就是 agent）
ctx.settings          → FileSettingsProvider，get#1 / update#3 / write#4，无 set
```

类型定义把 `followup` 标在 `Agent` / `ReactLoopAgent` 上是对的，错在我们假设 `create()` 直接返回 `Agent`。

同类问题在事件词表上更严重。真实 `SessionEventMap`（`@deepseek-ai/dsh-session/lib/types/types.d.ts:223-354`）只有：`turn/start`、`turn/end`、`step/start`、`step/end`、`user/message`、`assistant/chunk`、`assistant/message`、`tool/call`、`tool/result`、`todo/write`、`request/header`、`request/context`、`session/end-seed`。

我们自己编的 `turn-success`、`tool`、`tool-end`、`plan-approved` 全部不存在。`tool/result`（`:304-313`）只有 `error?: { name, code }`，**没有耗时字段**，所以 `tool-long` 从原理上永不可算。

监听签名是**两个参数**（`lib/types/index.d.ts:66`）：

```ts
'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void
```

`turn/end` 的 `data.reason`（`TurnEndReasonMap:135-167`）有 `completed` / `aborted` / `blocked` / `error` / `max-tokens` / `interrupted`——把 `turn/end` 一律当成功是错的。

`agentPreset` 在 `session.header.agentPreset`（`types.d.ts:71-77`），不在事件根上。

## 4. 门禁的盲区分层

| 层 | 看得见 | 看不见 |
|---|---|---|
| `pnpm test` | 注入 seam 后的行为 | 生产走哪条分支 |
| `typecheck` | 类型契约 | 运行时真实形状 |
| `smoke`（挂载行 + 路由 200） | host `apply()` 跑过 | 客户端能否加载；功能能否用 |
| `browser-smoke`（无 `Failed to load plugins` + boot graph） | 客户端半区加载成功 | 加载完之后能不能用 |

七例全部落在最后一列。补的办法只有一种：**在真实实例上做二值功能断言**。本轮已落地的真实断言：

- `POST /friend/stage/chat` → 200 且 `sent: true`、`sessionId` 非空（改前 503）
- 同一 `DSH_HOME` 重启后 `sessionId` **不变**（改前每次新建）
- 启动日志 `grep 'is not registered'` 命中数为 0（改前命中 `friend-core`）
- `GET /friend/reactions/latest` 的 `kind` 非空（改前恒 `{"empty":true}`）
- 浏览器 Network 出现 `GET /friend/tts/audio/<id>` 200 且有字节（改前整页零次）
- 拖拽条 `getBoundingClientRect().height > 0` 且 `cursor` 非 `auto`（改前 280×0px / `cursor:auto`）
- `POST /friend/memory/distill` 的失败信息是官方 `dsh-llm MISSING_CREDENTIAL`，**不是**自家抛错桩（区分「缺 key」与「撞桩」）

## 5. 无 API key 环境下能验到哪一步

隔离 profile 没有凭据，所以「说话 → 伴侣回答 → 出声 → 口型」这条北极星链路的**模型回合**验不了。但可以把链路切开，逐段用不依赖 LLM 的触发器验：

| 段 | 不依赖 LLM 的验证方式 |
|---|---|
| 消息进会话 | `POST /friend/stage/chat` 看 `sent` / `sessionId` |
| ASR → 目的地 | `window.__DSH_FRIEND_ASR__.submitFinal(marker)`，抓 Network 里的 POST |
| 合成 → 播放 → 口型 | `POST /friend/tts/preview`（试听不受 `autoSpeak` 闸），看 `/friend/tts/audio` 字节与能量序列 |
| 会话事件 → 反应 | `POST /api/session.create` + `session.prompt`（agent loop 在调模型**之前**就 append `turn/start`） |
| LLM 触点真的接上 | 看失败码是官方 `MISSING_CREDENTIAL` 而非自家桩 |

最后一段是本轮方法论上的关键：**「因为缺 key 而失败」本身就是「请求真的交出去了」的证据**，与「撞在自己的抛错桩上」是可区分的两种输出。
