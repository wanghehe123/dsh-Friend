# work-reactions Specification

## Purpose

工作陪伴反应：观察 dsh 会话事件元数据，把编码工作节奏映射为舞台小表演（庆祝/关心/提醒），带隐私边界与节流。对应迁移计划 §5.8，工作项 W-M7-5…7。

## Requirements

### Requirement: 事件订阅与隐私边界
系统 SHALL 订阅全局会话事件并归一化为内部事件（turn-start/tool-long/tool-error/turn-success/plan-approved）；SHALL 只读取事件元数据（类型/时长/成败），不读取用户文本与文件内容；伴侣预设会话与静音名单内的会话 SHALL 被排除。

#### Scenario: 隐私断言
- **WHEN** 检查任一内部事件对象
- **THEN** 其中不含用户输入文本、模型回复或文件内容字段

#### Scenario: 伴侣会话不自反
- **WHEN** 用户与伴侣对话产生若干轮次
- **THEN** 不触发任何工作反应

### Requirement: 反应映射与节流
系统 SHALL 按内置映射表把内部事件转为舞台指令，并施加节流：全局冷却 45 s、同类事件 5 分钟、免打扰时段全禁、单会话可静音；全部参数可配。

#### Scenario: 密集完成只庆祝一次
- **WHEN** 90 秒内连续完成 3 个 turn
- **THEN** 庆祝表演只出现 1 次

#### Scenario: 免打扰
- **GIVEN** 当前处于配置的免打扰时段
- **WHEN** 任何工作事件发生
- **THEN** 零反应

### Requirement: 台词三档
系统 SHALL 提供三档反应强度：仅动作（默认）、动作+气泡台词（内置台词库每类 ≥ 8 条，随机窗口 3 内不重复）、动作+语音（台词经 TTS 队列播放）；档位切换即时生效。

#### Scenario: 档位切换
- **WHEN** 从「仅动作」切到「动作+气泡」后触发一次 turn-success
- **THEN** 出现动作与台词气泡，且短窗口内台词不重复
