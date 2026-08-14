# legacy-import Specification

## Purpose

旧数据迁移：把 Kokoro-Engine 的 `kokoro.db`（SQLite）与本地素材一次性导入 dsh-Friend 的 Markdown/JSON 数据布局，CLI 与配置中心按钮两个入口。对应迁移计划 §7，工作项 W-M5-8。

## Requirements

### Requirement: 只读导入
导入器 SHALL 以只读方式打开旧库，按映射表转换：memories → `memory/imported/YYYY-MM-DD.md`（source 标 `import`）+ 高重要度事实汇总入 MEMORY.md、characters → persona.json、成长节拍 → story.md/beliefs.md、`user_profile.json` → USER.md、live2d 模型目录拷贝、pet_config → 壳配置；完成后 SHALL 产出迁移报告（各类计数与跳过原因）。

#### Scenario: 真实旧库跑通
- **WHEN** 对真实 kokoro.db 运行导入
- **THEN** 报告计数与库内行数一致，旧库文件内容与 mtime 不变

#### Scenario: 导入后可召回
- **WHEN** 导入完成后问伴侣一件旧记忆中的既有事实
- **THEN** 伴侣经记忆检索正确答出

### Requirement: 幂等重入
导入 SHALL 幂等：重复执行不产生重复条目（已导入标记跳过），报告注明跳过数。

#### Scenario: 重复导入
- **WHEN** 对同一旧库连续导入两次
- **THEN** 第二次全部标记跳过，数据文件与第一次结束时逐字节一致
