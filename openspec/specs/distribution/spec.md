# distribution Specification

## Purpose

分发与工程底盘：monorepo 与聚合包、一条命令安装、零配置启动北极星、dsh-compat 防波堤、CI/canary、合规与发布。对应迁移计划 §4、§6、§10、§11，工作项 W-M0-*、W-M8-6…8。

## Requirements

### Requirement: 一条命令安装
系统 SHALL 以聚合包形式支持 `dsh plugin --profile web add` 一条命令安装全部插件，重启 `dsh web` 后全部半区挂载；11 个 npm 包 SHALL 同版本联动发布（changesets），聚合 patch/依赖与子包清单 SHALL 由脚本生成并在 CI 校验漂移。

#### Scenario: 干净环境安装
- **GIVEN** 只装有 dsh 的干净环境
- **WHEN** 执行安装命令并重启 `dsh web`
- **THEN** 设置页出现 dsh-Friend 卡片，悬浮层出现默认形象

### Requirement: 零配置北极星
安装后在不配置任何新 API key 的前提下，系统 SHALL 完成完整闭环：语音说话 → 伴侣以继承的 dsh 模型回答 → Edge TTS 朗读 → Live2D 口型与表情同步。

#### Scenario: 零 key 闭环
- **GIVEN** 用户只配过 dsh 本身的模型
- **WHEN** 按住快捷键说「你好」
- **THEN** 伴侣语音回答且口型同步，全程无任何 key 配置提示

### Requirement: dsh-compat 防波堤
所有对 dsh 易变 API 的运行时调用 SHALL 收敛于 `dsh-friend-shared/src/dsh-compat.ts`（六类：preset/section/tool/route/push/settings）；其余包 SHALL 仅允许类型导入官方 SDK（lint 守卫）。

#### Scenario: 违规导入被拦截
- **WHEN** 任一功能包直接运行时导入 `@deepseek-ai/*`
- **THEN** lint/CI 失败并指出应走 compat

### Requirement: CI 与 canary
仓库 SHALL 维持主干 CI（install/build/typecheck/test/aggregate check + 冒烟）为合并前置；SHALL 每周以 `@deepseek-ai/*@latest` 重装构建（canary），失败自动开 issue 以尽早暴露上游破坏性变更。

#### Scenario: canary 报警
- **WHEN** dsh 发布了破坏 compat 层的新版本且周任务运行
- **THEN** canary 失败并创建带日志链接的 issue

### Requirement: 许可合规
仓库 SHALL 保留上游 MIT 版权声明（`Copyright (c) 2026 chyinan`）并在 README 声明衍生关系；SHALL 维护 `docs/assets-compliance.md`（Hiyori/Cubism/鲸鱼娘授权台账）与 `THIRD-PARTY-NOTICES.md`；npm 发布物 SHALL 不含 Live2D 专有文件（CI 断言）。

#### Scenario: 合规审计
- **WHEN** 逐项核对迁移计划 §11 合规表
- **THEN** 每行都有对应落地物（文件或 CI 检查）
