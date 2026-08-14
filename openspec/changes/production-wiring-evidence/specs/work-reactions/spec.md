## MODIFIED Requirements

### Requirement: 事件订阅与隐私边界
系统 SHALL 通过 `ctx.on('session/event')` 订阅全局会话事件，监听器 SHALL 按官方 **`(session, event)` 两个参数**的签名接收（依据 `@deepseek-ai/dsh-session/lib/types/index.d.ts:66`）；SHALL NOT 只取第一个参数——`Session` 只有 `id` 与 `header`，不含事件类型，只取它会让归一化恒返回空。

内部事件词表 SHALL 只包含能由真实 `SessionEventMap`（`lib/types/types.d.ts:223-354`）推导出的 kind：

| 内部 kind | 真实 DSH 事件 | 判定 |
|---|---|---|
| `turn-start` | `turn/start` | 事件类型本身 |
| `turn-success` | `turn/end` | 仅当 `data.reason.kind === 'completed'` |
| `tool-error` | `tool/result` | `data.error.{name,code}` 或结果块 `isError === true` |

`turn/end` SHALL NOT 一律判为成功——`TurnEndReasonMap`（`:135-167`）有 `completed` / `aborted` / `blocked` / `error` / `max-tokens` / `interrupted` 六种。

预设标识 SHALL 从 `session.header.agentPreset` 读取（`types.d.ts:71-77`），SHALL NOT 假设它挂在事件对象根上。

隐私边界不变：SHALL 只读取事件元数据（类型/成败），不读取用户文本与文件内容；伴侣预设会话与静音名单内的会话 SHALL 被排除。

#### Scenario: 官方两参签名
- **WHEN** 通过真实 `ctx.on('session/event')` 路径投递一个 `turn/start`
- **THEN** 归一化产出 `kind: turn-start`；若监听器只接收到 `session` 而无 `event`，则该事件被丢弃且不产出反应

#### Scenario: 失败的 turn 不庆祝
- **WHEN** 收到 `turn/end` 且 `data.reason.kind` 不是 `completed`
- **THEN** 不产出 `turn-success`

#### Scenario: 隐私断言
- **WHEN** 检查任一内部事件对象
- **THEN** 其中不含用户输入文本、模型回复或文件内容字段

#### Scenario: 伴侣会话不自反
- **WHEN** 用户与伴侣对话产生若干轮次
- **THEN** 不触发任何工作反应

## REMOVED Requirements

### Requirement: tool-long 与 plan-approved 事件
**移除原因**：这两个 kind 在 DSH 里不存在，无法实现。

- `tool-long` 需要工具耗时，而真实 `tool/result`（`types.d.ts:304-313`）只有 `error?: { name, code }`，**没有任何耗时字段**，从原理上永不可算
- `plan-approved` 不在 `SessionEventMap` 中，DSH 从不产生该事件

原规范把这两个 kind 写进归一化词表，导致实现按自编词表编码，测试用自造事件流断言了一条**现实中不存在的通路**。
