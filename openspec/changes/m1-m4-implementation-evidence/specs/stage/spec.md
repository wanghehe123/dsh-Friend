## MODIFIED Requirements

### Requirement: 合规资产下载
系统 SHALL 不在 npm 包内嵌 Live2D Cubism Core 与示例模型；首次启用形象时从官方源下载 Cubism Core 与占位模型（Hiyori）及其 NOTICE 到 `vendor/`，经 sha256 校验后落盘，进度经 SSE 推送，失败可重试；静态服务以 `kind: 'prefix'` 注册于 `/friend/assets`，SHALL 防路径穿越，并 SHALL 自行校验 HTTP method（rc.6 路由不按 method 分流）。

发布物审计 SHALL **按文件**扫描：tarball 内不得存在 `.moc3`、`.model3.json`、`live2dcubismcore.min.js` 等 Live2D 专有或素材文件。SHALL NOT 用全文 `rg live2dcubismcore` 作为判据——`lib/pet.iife.js` 合法引用全局名 `Live2DCubismCore`（`pixi-live2d-display` 要求页面先加载官方 Core），按字面检索必然误报。

#### Scenario: 首启下载
- **GIVEN** 全新数据目录
- **WHEN** 用户首次启用形象
- **THEN** 进度条完成后模型出现，`vendor/` 含 NOTICE 文件

#### Scenario: 发布物零内嵌
- **WHEN** 按文件审计已发布 npm tarball
- **THEN** 不存在 `.moc3` / `.model3.json` / `live2dcubismcore.min.js` 等专有文件；允许 JS 源码中出现全局名 `Live2DCubismCore` 的引用

#### Scenario: 静态服务边界
- **WHEN** 请求 `/friend/assets/../../etc/passwd` 或以非 GET method 请求资产
- **THEN** 分别返回 403 与 405，且不读取数据目录之外的文件

### Requirement: 表情标签协议
系统 SHALL 流式解析回复中的舞台协议标签（含跨 chunk 断裂缓冲）。处理分三类（提案决策 I-A，待确认；证据：`packages/dsh-friend-stage/src/tag-parser.ts`）：

1. 形态合法且词在对应词表内（`[expr:<标准词表7词>]` / `[motion:<组名>]` / `[cue:<演出名>]`）：从展示文本**和** TTS 文本剥离，并应用到舞台。
2. 形态合法但词不在表内（如 `[expr:excited]`）：仍从展示与 TTS 剥离，但不应用。协议形标签 SHALL NOT 泄漏给用户。
3. 形态非法（如 `[foo:bar]`、无冒号、含空格）：按原文透传，以免把 `array[0]` 这类正文吃掉。

未闭合的 `[` 缓冲超过 48 字符 SHALL 当普通文本吐出，避免永久吞正文。

#### Scenario: 跨 chunk 断裂标签
- **WHEN** 流式输出把 `[expr:happy]` 拆成 `[ex` 与 `pr:happy]` 两个 chunk
- **THEN** 表情正确切换且屏幕与语音均不出现标签残片

#### Scenario: 未知词剥离但不应用
- **WHEN** 回复含 `[expr:excited]`
- **THEN** 屏幕与朗读均不含该标签，舞台表情不切换

#### Scenario: 形态非法透传
- **WHEN** 回复含 `array[0]` 或 `[foo:bar]`
- **THEN** 该片段按原文出现在展示文本中

#### Scenario: 过长未闭合标签释放
- **WHEN** 流式输出以 `[` 开头且连续 48 个字符仍无 `]`
- **THEN** 缓冲按普通文本吐出，后续正文不再被吞

### Requirement: 表演工具
系统 SHALL 注册 `set_expression` / `play_motion` / `play_cue` 三个工具。参数 schema SHALL 为 rc.6 `defineTool` 的 `ParameterSchemaSpec`：一张隐式 object 的属性表，每项 `{ type, enum?, required?, description? }`，编译成 JSON Schema；**不是** zod，也 **不是** schemastery `Schema`（schemastery 仅用于 settings，`defineTool` 不消费它）。`output.schema` 与 `output.render` SHALL 必填。
证据：`@deepseek-ai/dsh-tools/lib/types/schema.d.ts`（`ParameterPropertySpec` / `ParameterSchemaSpec` / `DefineToolOptions`）；实现 `packages/dsh-friend-stage/src/tools.ts`。

工具仅进入伴侣预设白名单。rc.6 无法进程外核对「编码会话的工具列表」；「编码会话不可见」SHALL 用白名单/restrict 单测 + 真实伴侣会话触发一次工具调用的行为验收，并标 manual 抽查编码会话，待官方 inspect 后升级（提案决策 D-A，待确认）。工具执行经推送通道驱动舞台，端到端生效 ≤ 500 ms。

#### Scenario: 模型主动表演
- **WHEN** 对伴侣说「做个开心的表情」
- **THEN** 会话流出现工具调用且悬浮层表情在 500 ms 内切换

#### Scenario: 参数拒绝词表外表情
- **WHEN** 调用 `set_expression` 且 expression 不在标准 7 词
- **THEN** 调用被 schema 拒绝，舞台不变化

## ADDED Requirements

### Requirement: stage host 的 Cordis inject
stage host 模块 SHALL 导出 `export const inject = ['webServer', 'tools']`。访问 `ctx.webServer` 或 `ctx.tools` 前未声明对应 inject SHALL 导致挂载失败（证据：`packages/dsh-friend-stage/src/index.ts`）。

#### Scenario: 缺少 inject
- **WHEN** stage host 读取 `ctx.webServer` 或 `ctx.tools` 但未声明对应 inject
- **THEN** Cordis 抛出 `cannot get property "…" without inject`，插件树挂载失败
