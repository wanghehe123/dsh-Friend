# memory Specification

## Purpose

Markdown 长期记忆：OpenClaw 式明文存储（MEMORY.md + 每日笔记 + USER.md）、可插拔检索接口（默认 ripgrep 实现，不依赖 embedding）、记忆工具、启动注入、会话自动小结与夜间蒸馏。对应迁移计划 §5.2，工作项 W-M5-1…7。

## Requirements

### Requirement: Markdown 存储布局
系统 SHALL 按以下布局持久化记忆且全部文件人类可读、可外部编辑：`MEMORY.md`（固定四分节：关于用户/重要事实/近期主题/待办与约定）、`memory/YYYY-MM-DD.md`（每日笔记，条目格式 `- HH:mm [source] 内容`，追加为原子写）、`USER.md`（用户画像）。

#### Scenario: 外部编辑无脏读
- **GIVEN** 用户用编辑器修改了 MEMORY.md 的一条事实
- **WHEN** 下一次组装伴侣会话提示词
- **THEN** 注入的是修改后的内容

#### Scenario: 并发追加不丢条目
- **WHEN** 自动小结与 memory_append 工具几乎同时写入当日笔记
- **THEN** 两条内容都完整存在，文件无交错损坏

### Requirement: 体积上限与归档
系统 SHALL 对 MEMORY.md 施加体积上限（默认 8 KB，可配），超限在蒸馏时压缩回上限内；每日笔记按月归档到 `memory/archive/YYYY-MM/`。

#### Scenario: 月度归档
- **GIVEN** 存在上上个月的每日笔记
- **WHEN** 归档任务运行
- **THEN** 这些笔记移入对应归档目录，且检索仍能命中归档内容

### Requirement: 可插拔检索
系统 SHALL 通过 `MemoryRetriever` 接口提供检索（`search`/`get`/`bootstrap`）；默认实现基于 ripgrep 子进程（参数化调用，无 shell 注入面），覆盖 MEMORY.md、全部每日笔记与 story.md，返回 path/行号/±2 行片段/评分，上限 20 条。未来 embedding 实现 SHALL 仅替换该接口而不改调用方。

#### Scenario: 关键词召回历史
- **GIVEN** 三天前的笔记包含「8 月 3 日是用户生日」
- **WHEN** `search("生日")`
- **THEN** 命中该条并给出正确文件与行号

#### Scenario: 注入防护
- **WHEN** query 为 `"; rm -rf ~"` 之类含 shell 元字符的字符串
- **THEN** 检索按字面执行且无任何子进程副作用

### Requirement: 记忆工具
系统 SHALL 向伴侣预设注册三个工具：`memory_append`（target: daily|longterm）、`memory_search`、`memory_get`；path 参数限制在数据目录白名单内。

#### Scenario: 记住并召回
- **WHEN** 用户对伴侣说「记住我不吃香菜」
- **THEN** 当日笔记新增一条带时间戳的记录
- **WHEN** 下一个会话问「我忌口什么」
- **THEN** 伴侣经 search→get 召回并正确回答

#### Scenario: 越界路径拒绝
- **WHEN** `memory_get` 的 path 指向数据目录之外
- **THEN** 调用被拒绝并返回错误

### Requirement: 启动注入
系统 SHALL 在伴侣会话系统提示词注入记忆区：MEMORY.md 全文 + 今日与昨日笔记 + USER.md；超出预算时按「MEMORY 优先、笔记按时间倒序截断」策略裁剪；scope 仅限伴侣预设。

#### Scenario: 新会话带着昨日记忆
- **GIVEN** 昨日笔记存在
- **WHEN** 新建伴侣会话
- **THEN** 系统提示词包含昨日笔记条目

### Requirement: 会话自动小结
系统 SHALL 监听伴侣会话轮次结束，空闲去抖（默认 10 分钟，可配可关）后用归纳模型把增量对话压成 1-3 条事实写入当日笔记（source 标 `chat`）；同一对话区间 SHALL 不重复小结（幂等水位线）。

#### Scenario: 静置后产生小结
- **WHEN** 对话结束并静置超过去抖时长
- **THEN** 当日笔记新增 `[chat]` 条目且内容与对话相符

#### Scenario: 关闭开关即停
- **GIVEN** 自动小结开关关闭
- **WHEN** 对话结束静置任意时长
- **THEN** 不产生任何小结条目

### Requirement: 夜间蒸馏
系统 SHALL 每日定时（默认 04:00，可配）及手动触发蒸馏：先滚动备份 MEMORY.md（保留 7 份）→ 读近 7 天笔记与现有 MEMORY.md → LLM 重写四分节（新事实优先、矛盾保留双方并标日期、体积回到上限内）→ 原子替换；LLM 输出损坏或流程失败 SHALL 回滚备份。

#### Scenario: 护栏——重要事实不丢
- **GIVEN** MEMORY.md 含标注「重要」的事实
- **WHEN** 蒸馏完成
- **THEN** 该事实仍在（允许改写措辞，不允许消失）

#### Scenario: 中断安全
- **WHEN** 蒸馏过程中进程被杀死
- **THEN** 重启后 MEMORY.md 为完整的旧版或完整的新版，绝不出现半写状态
