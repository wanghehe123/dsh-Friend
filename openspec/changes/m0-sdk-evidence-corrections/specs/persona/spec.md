## MODIFIED Requirements

### Requirement: 伴侣 Agent 预设
系统 SHALL 以**预设目录**方式提供 `friend-companion`（工具白名单：memory 三件、表演三件、notify、time）与 `friend-companion-plus`（在前者基础上追加 dsh 网页搜索与文件只读）：随包投放 `presets/<id>/agent.cordis.yml`（rc.6 的预设组装文件名）并使其被 `ctx.agentPresets` 的 roots 发现；启动期 SHALL 断言 `resolve(id)` 成功且未标记 broken，失败即 fail-loud。工具白名单 SHALL 在预设常驻 scope 上调用 `tools.restrict`（host 全局 scope 调用会抛错），白名单外的工具在伴侣会话中不可见。

#### Scenario: 白名单收紧
- **WHEN** 检查 `friend-companion` 会话可用工具列表
- **THEN** 列表与白名单完全一致，bash/文件写入类工具不出现

#### Scenario: plus 是超集
- **WHEN** 比较两个预设的工具集合
- **THEN** `friend-companion-plus` ⊇ `friend-companion`

#### Scenario: 预设未被发现时 fail-loud
- **GIVEN** 预设目录未被投放或 roots 未包含它
- **WHEN** 插件启动
- **THEN** 抛出可读错误指出预设 id 与期望路径，而不是静默退化为全局注册

### Requirement: 模型继承与按用途覆写
系统 SHALL 默认继承 dsh 当前配置的文本模型；`resolveModel(purpose)` 支持 chat/summarize/growth 三个用途分别覆写（值为已注册模型 id 或 OpenAI 兼容端点配置），非法覆写回退默认并告警。覆写项 SHALL 存放于 kebab 设置命名空间（`friend-persona` 的 `chatModel`、`friend-memory` 的 `summarizeModel`、`friend-growth` 的 `model`），命名空间 SHALL 不含点号。

#### Scenario: 零配置对话
- **GIVEN** 用户未做任何 friend 模型配置
- **WHEN** 与伴侣对话
- **THEN** 请求走 dsh 当前模型，对话成功

#### Scenario: 归纳模型覆写生效
- **GIVEN** `friend-memory` 命名空间的 `summarizeModel` 被设置为另一模型
- **WHEN** 触发会话自动小结
- **THEN** 小结请求使用覆写模型（日志可证），伴侣对话仍走 dsh 默认模型
