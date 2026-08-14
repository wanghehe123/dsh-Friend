# persona Specification

## Purpose

人设与伴侣会话能力：角色卡的存储与导入、人格进入系统提示词、伴侣 Agent 预设（工具白名单）、常驻伴侣会话、模型继承与按用途覆写。对应迁移计划 §5.1，工作项 W-M1-*。

## Requirements

### Requirement: 角色卡存储
系统 SHALL 以 `characters/<slug>/persona.json` 存储角色卡，写入前经 schema 校验（name/personality/background/speakingStyle/language/nickname/greetings/live2dModel/voice/tags），并在首次启动时种子化内置默认角色。

#### Scenario: 全新环境首启即有角色
- **GIVEN** 数据目录 `~/.dsh/friend/` 不存在
- **WHEN** dsh 加载插件完成首次初始化
- **THEN** 默认角色的 persona.json 被创建，且伴侣会话可直接以该角色对话

#### Scenario: 非法角色卡被拒绝
- **WHEN** 写入缺少 `name` 字段或类型错误的角色卡
- **THEN** 写入被拒绝并返回可读错误，磁盘上原文件保持不变

#### Scenario: 外部编辑生效
- **GIVEN** 用户直接用编辑器修改了 persona.json
- **WHEN** 下一次组装伴侣会话系统提示词
- **THEN** 注入内容反映修改后的值

### Requirement: 酒馆角色卡导入
系统 SHALL 支持导入 SillyTavern 角色卡（PNG tEXt chunk 与 JSON 两种载体，兼容 V2 卡规范），并把字段映射到 persona schema，缺失字段使用文档化的回退值。

#### Scenario: PNG 卡导入
- **WHEN** 用户在配置中心上传一张合法的酒馆 PNG 卡
- **THEN** 生成新的 persona.json，角色出现在角色下拉列表且可被选为当前角色

### Requirement: 人格提示词分区
系统 SHALL 仅在伴侣预设的会话中注入人格分区（persona 渲染 + `beliefs.md`（若存在）+ 行为守则：表情标签协议、记忆记录守则、语言约束）；非伴侣预设的会话 SHALL 不含任何 friend 分区。

#### Scenario: 伴侣会话包含人格
- **WHEN** 以 `friend-companion` 预设创建会话
- **THEN** 首条系统提示词包含当前角色名、性格描述与表情协议守则

#### Scenario: 编码会话零污染
- **WHEN** 以 dsh 默认编码预设创建会话
- **THEN** 系统提示词不包含人格、记忆、表情协议中的任何 friend 分区文本

### Requirement: 伴侣 Agent 预设
系统 SHALL 注册 `friend-companion`（工具白名单：memory 三件、表演三件、notify、time）与 `friend-companion-plus`（在前者基础上追加 dsh 网页搜索与文件只读），白名单外的工具在伴侣会话中不可见。

#### Scenario: 白名单收紧
- **WHEN** 检查 `friend-companion` 会话可用工具列表
- **THEN** 列表与白名单完全一致，bash/文件写入类工具不出现

#### Scenario: plus 是超集
- **WHEN** 比较两个预设的工具集合
- **THEN** `friend-companion-plus` ⊇ `friend-companion`

### Requirement: 常驻伴侣会话
系统 SHALL 维护一个常驻伴侣会话：会话 id 持久化，失效时自动重建，并提供 `sendToCompanion(text)` 供气泡输入与桌面壳复用。

#### Scenario: 重启续写同一会话
- **GIVEN** 昨天通过气泡与伴侣聊过
- **WHEN** 重启 dsh 后再次在气泡输入
- **THEN** 消息追加到同一会话（会话 id 不变），主会话页可见完整历史

#### Scenario: 会话被删后自愈
- **GIVEN** 用户在 dsh 里删除了常驻会话
- **WHEN** 下一次气泡输入
- **THEN** 自动创建新会话并正常回复，不抛错

### Requirement: 模型继承与按用途覆写
系统 SHALL 默认继承 dsh 当前配置的文本模型；`resolveModel(purpose)` 支持 chat/summarize/growth 三个用途分别覆写（值为已注册模型 id 或 OpenAI 兼容端点配置），非法覆写回退默认并告警。

#### Scenario: 零配置对话
- **GIVEN** 用户未做任何 friend 模型配置
- **WHEN** 与伴侣对话
- **THEN** 请求走 dsh 当前模型，对话成功

#### Scenario: 归纳模型覆写生效
- **GIVEN** `friend.memory.summarizeModel` 被设置为另一模型
- **WHEN** 触发会话自动小结
- **THEN** 小结请求使用覆写模型（日志可证），伴侣对话仍走 dsh 默认模型
