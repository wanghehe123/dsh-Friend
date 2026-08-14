## MODIFIED Requirements

### Requirement: 人格提示词分区
系统 SHALL 仅在伴侣预设的会话中注入人格分区（persona 渲染 + `beliefs.md`（若存在）+ 行为守则：表情标签协议、记忆记录守则、语言约束）；非伴侣预设的会话 SHALL 不含任何 friend 分区。

rc.6 **没有**进程外 HTTP/CLI 可查询某预设的系统提示词：`dsh-system-prompt` 仅进程内 `assemble()`，`dsh` CLI 与 `dsh-host-webserver` 均无 inspect。因此「编码会话零污染」SHALL 按可执行路径验证，而不是假设能抓到另一会话的提示词；等官方提供查询能力后 SHALL 升级为自动断言（提案决策 D-A，待确认）：

- unit：mock 组装管线——host `apply()` 之后，非伴侣 preset 的组装结果不含任何 friend 分区（证据：`packages/dsh-friend-persona/test/apply.test.ts`）；
- int：真实伴侣会话首条系统提示词含角色名与守则；
- manual：同 profile 打开 dsh 默认编码会话，抽查提示词不含 friend 分区。

#### Scenario: 伴侣会话包含人格
- **WHEN** 以 `friend-companion` 预设创建会话
- **THEN** 首条系统提示词包含当前角色名、性格描述与表情协议守则

#### Scenario: 编码会话零污染
- **GIVEN** host 半区已 `apply()` 且 mock 组装管线可按 preset id 分别组装
- **WHEN** 以非伴侣预设 id（如 `standard`）组装系统提示词
- **THEN** 结果不含人格、记忆、表情协议中的任何 friend 分区文本

#### Scenario: 编码会话零污染（人工抽查，待官方 inspect 升级）
- **WHEN** 同 profile 打开 dsh 默认编码会话并查看系统提示词
- **THEN** 不含任何 friend 分区；本场景在 rc.6 下标记为 manual，官方提供进程外查询后改为自动断言

### Requirement: 伴侣 Agent 预设
系统 SHALL 以**预设目录**方式提供 `friend-companion`（工具白名单：memory 三件、表演三件、notify、time）与 `friend-companion-plus`（在前者基础上追加 dsh 网页搜索与文件只读）：随包投放 `presets/<id>/agent.cordis.yml`（rc.6 的预设组装文件名）并使其被 `ctx.agentPresets` 的 roots 发现；启动期 SHALL 断言 `resolve(id)` 成功且未标记 broken，失败即 fail-loud。工具白名单 SHALL 在预设常驻 scope 上调用 `tools.restrict`（host 全局 scope 调用会抛错），白名单外的工具在伴侣会话中不可见。

persona host 模块 SHALL 导出 `export const inject = ['agentPresets', 'systemPrompt', 'tools']`。访问 `ctx.agentPresets` / `ctx.systemPrompt` / `ctx.tools` 前未声明对应 inject，Cordis 代理在读属性（含与 `undefined` 比较）时 SHALL 抛错并导致插件树挂载失败（证据：冒烟 `cannot get property "agentPresets" without inject`；`packages/dsh-friend-persona/src/index.ts`）。

`resolve(id)` 成功后 SHALL 向 stdout 输出一行 `dsh-friend:preset-ready <预设 id>`（证据：`packages/dsh-friend-persona/src/presets.ts` 的 `PRESET_READY_LOG_EVENT`）。冒烟脚本依赖该行判断预设可用。

rc.6 无法在进程外枚举某预设的工具列表（`dsh-tools` 的 `get`/`schemas` 需要进程内 `ScopeKey`；常驻挂载是**第一次有会话使用该预设时**才 `ensureStanding`，`dsh web` 启动时并不会注册预设内工具）。白名单验收 SHALL 用可执行路径，等官方查询能力后升级为自动断言（提案决策 D-A，待确认）：

- unit：白名单集合与 plus 超集；restrict 在 companion-preset 角色上调用；
- int：真实伴侣会话中触发一次白名单内工具；
- manual：抽查编码会话看不到伴侣白名单工具。

#### Scenario: 白名单收紧
- **WHEN** 检查 `friend-companion` 的 restrict allowlist 与 unit 白名单常量
- **THEN** 列表与白名单完全一致，bash/文件写入类工具不在 allowlist 中

#### Scenario: 白名单收紧（伴侣会话行为）
- **WHEN** 在真实 `friend-companion` 会话中请求一次表演类动作
- **THEN** 会话流出现对应工具调用；bash 类工具未被当作已注册工具成功执行

#### Scenario: plus 是超集
- **WHEN** 比较两个预设的工具集合
- **THEN** `friend-companion-plus` ⊇ `friend-companion`

#### Scenario: 预设未被发现时 fail-loud
- **GIVEN** 预设目录未被投放或 roots 未包含它
- **WHEN** 插件启动
- **THEN** 抛出可读错误指出预设 id 与期望路径，而不是静默退化为全局注册

#### Scenario: 预设就绪标记
- **WHEN** 启动期 `resolve(id)` 成功
- **THEN** 日志出现 `dsh-friend:preset-ready friend-companion` 与 `dsh-friend:preset-ready friend-companion-plus`

#### Scenario: 缺少 inject 则挂载失败
- **WHEN** persona host 未声明 `inject` 含 `agentPresets` 却读取 `ctx.agentPresets`
- **THEN** Cordis 抛出 `cannot get property "agentPresets" without inject`，插件树挂载失败
