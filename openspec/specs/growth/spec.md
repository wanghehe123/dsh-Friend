# growth Specification

## Purpose

成长（人生故事）系统：LLM 驱动的 outline → expand → reflect 三阶段流水线，为角色生成编年人生故事与信念，产物进入提示词与检索面。对应迁移计划 §5.7，工作项 W-M7-1…4。

## Requirements

### Requirement: 与旧实现行为等价
移植自 `ai/growth.rs` 的纯函数（节拍解析、按年龄排序、全角年龄前缀、importance 缺省 0.7 / 反思下限 0.9、畸形 LLM 输出容错）SHALL 与旧 Rust 实现行为等价，以直译单测与同 fixture 对拍验证。

#### Scenario: 直译单测全绿
- **WHEN** 运行由旧 Rust 单测逐条直译的测试集
- **THEN** 100% 通过，且同一 fixture 新旧实现输出等价

### Requirement: 三阶段流水线
系统 SHALL 以 outline → expand（每批 4 个节拍）→ reflect 三阶段生成成长内容，使用 `resolveModel('growth')`；产物先落草稿态 `growth/<batch>/` 不自动提交；流水线 SHALL 可中断续跑（按批幂等），进度经 SSE 推送。

#### Scenario: 全程生成
- **WHEN** 对新角色点击「生成人生故事」
- **THEN** 默认模型下 5 分钟内产出完整草稿并显示进度

#### Scenario: 断点续跑
- **WHEN** 生成中途进程被杀死后重启并继续
- **THEN** 从未完成的批次继续，已完成批次不重复生成

### Requirement: 草稿审阅与提交
系统 SHALL 提供草稿预览（可勾除个别节拍）与显式提交：episodes 写入 `story.md`（编年、全角年龄前缀）、reflections 写入 `beliefs.md`、人生小结进入 MEMORY.md「近期主题」节；提交幂等（同 batch 重复提交为覆盖）；story.md SHALL 进入记忆检索面。

#### Scenario: 勾除生效
- **WHEN** 预览中勾除 1 个节拍后提交
- **THEN** 被勾除节拍不出现在 story.md

#### Scenario: 故事被引用
- **GIVEN** 已提交人生故事
- **WHEN** 问伴侣「你小时候的事」
- **THEN** 回答引用 story.md 中的情节；beliefs.md 内容出现在人格分区
