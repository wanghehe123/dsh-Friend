## ADDED Requirements

### Requirement: 生产路径可达性
凡以「可注入 seam」形式写成的依赖（`config.x ?? 默认`、`options.y`、导出的工厂函数），其**默认分支 SHALL 是生产真正走的那一条，并且 SHALL 能工作**。SHALL NOT 把抛错桩、空实现、或依赖生产上拿不到之物的实现放在默认位置，靠测试注入 seam 来取得绿灯。

每个 seam SHALL 能回答「生产路径上谁调用它」。答案为「仅测试」「无」「仅自身再导出」时，该能力 SHALL 被视为**未落地**，不得计入验收。

证据：七例同类缺陷。`complete ?? (async () => { throw })`（memory/growth 的 LLM 调用）、`if (config.coreSchema !== undefined)` 包住唯一的设置注册调用、`options.onSend?.()` 静默丢弃全部 ASR 终稿、`getFriendTtsClient()` 零生产调用方、`dsh-friend:lipsync` 只有监听无派发。

#### Scenario: 默认分支必须可用
- **WHEN** 不注入任何 seam 地调用某个 `apply()`
- **THEN** 该能力的核心路径能真的完成一次工作，而不是抛「未注入」或静默退化

#### Scenario: 无调用方即未落地
- **WHEN** 某导出的生产入口在全仓只被测试或自身再导出引用
- **THEN** 对应工作项不得标记为已落地

### Requirement: 测试假件与运行时同构
单元测试的 dsh context 假件 SHALL 与真实 Cordis 语义同构：

- 服务 SHALL 经 Proxy `get` trap 暴露，SHALL NOT 放成 own property——否则 `hasOwnProperty` 式探测在测试里为真、在生产里恒假（依据 `@deepseek-ai/cordis/src/reflect.ts:136-166`）
- 未声明的属性读取 SHALL 抛错（`reflect.ts:144`）
- 假服务方法 SHALL 依赖 `this`——否则解构后调用在测试里能过、在生产里抛 `this.write is not a function`（实测 `settings.update.call({})` 即抛；`SettingsProvider.update#3` 内部调 `this.write#4`）

SHALL NOT 用对象字面量假 ctx 掩盖上述语义。测试 SHALL NOT 为错误行为写正向断言，也 SHALL NOT 为生产不可达的分支写覆盖用例后计入验收。

#### Scenario: 服务探测方式错误被抓住
- **WHEN** 任何代码用 `hasOwnProperty` / `Object.hasOwn` 判断 ctx 上的服务是否可用
- **THEN** 使用严格假件的测试失败

#### Scenario: 解构服务方法被抓住
- **WHEN** 任何代码解构 dsh 服务的方法后再调用
- **THEN** 使用严格假件的测试因 receiver 丢失而失败

### Requirement: DSH 触点以真实形状为基准
DSH 服务的方法名、arity、返回值结构、事件名与事件 payload SHALL 以 `node_modules/@deepseek-ai/*` 的真实 `.d.ts` 与真实运行时诊断为事实基准。SHALL NOT 依据推测或自编词表实现；凡靠运行时诊断确定的形状 SHALL 在注释中记录实测来源。

实测已确认的形状（rc.6）：

- `ctx.agents.create()` / `resume()` 返回 `{ agent, dispose }` **包装对象**，`followup()` 在 `.agent` 上；`ctx.agents.get(id)` 直接返回 agent
- `ctx.settings` 有 `get#1` / `update#3` / `write#4`，**无 `set`**，且 `update` 依赖 receiver
- `session/event` 监听签名是 `(session, event)` 两个参数
- `ctx.llm.stream(options)` 是流式补全入口

#### Scenario: 形状不符即失败
- **WHEN** 某 dsh 触点的调用方式与真实 `.d.ts` 或实测形状不一致
- **THEN** 在真实实例上必然失败，且该能力不得凭单测绿计为已落地

### Requirement: 双向连接完整性
事件、路由与跨包依赖 SHALL 两端齐备：

- 每个 `dispatch` / `emit` SHALL 有生产监听方；每个监听方 SHALL 有生产派发方
- 每个注册的路由 SHALL 有生产消费方（仅测试 fetch 的路由视为死路由）
- A 包提供的能力若需 B 包消费，B 包 SHALL 在 `package.json` 声明依赖并在 `src/` 真实 import
- 注册给 LLM 的工具 SHALL 真的挂进 companion preset

跨 iframe 的事件 SHALL 显式扇出到目标 frame（父窗 CustomEvent 不会自动进入 iframe），并 SHALL 有 `postMessage` 兜底。

#### Scenario: 单向连接被发现
- **WHEN** 审计任一自定义事件、路由或跨包能力
- **THEN** 两端都能给出生产侧的文件与行号

## MODIFIED Requirements

### Requirement: 客户端真实加载门禁
CI SHALL 包含一层浏览器级检查：在隔离 `DSH_HOME` 启动真实 `dsh web`、加载客户端页面，断言页面**不含** `Failed to load plugins` 且全部客户端半区加载成功。

以下四项 SHALL NOT 被当作功能可用的证据：

1. host 侧的 `dsh-friend:plugin-mount` / `dsh-friend:preset-ready` 日志行
2. `GET /friend/pet` 返回 200
3. 客户端 boot graph 里存在对应条目——它是服务端渲染的**计划**，不是执行结果
4. 客户端 `apply()` 跑过——跑过不等于跑完之后能用

门禁 SHALL 包含**真实功能断言**，即在真实实例上做二值判定的检查（例如关键端点非 5xx、交互元素真实几何可抓取、关键请求在 Network 上真实出现）。SHALL NOT 只断言「没崩」。

证据：七例缺陷同时存在时，上述四项曾**同时为绿**。其中悬浮层拖拽条实测 280×0 px、`cursor: auto`、四个缩放角 `position: static` 横向挤成一排，而对应 jsdom 单测因不加载样式表、无布局引擎而全绿。

#### Scenario: 客户端崩溃被拦住
- **WHEN** 任一 client 半区读未声明的 ctx 属性
- **THEN** 浏览器级检查失败，且失败信息指出是哪个包与哪个属性

#### Scenario: 加载成功但不可用被拦住
- **WHEN** 客户端半区全部加载成功，但某交互元素的真实几何不可抓取，或某关键端点返回 5xx
- **THEN** 浏览器级检查仍失败，并给出量到的具体数值

#### Scenario: host 绿不等于客户端可用
- **WHEN** host 打印全部挂载行且 `/friend/pet` 返回 200
- **THEN** 仍须通过浏览器级功能断言才视为该能力可用
