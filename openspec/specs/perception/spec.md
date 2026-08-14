# perception Specification

## Purpose

视觉感知接口预留：v1 因 DeepSeek 暂无多模态而砍掉屏幕观察功能，但保留可扩展接口与配置占位，未来多模态可用时以插件形式补上。对应迁移计划 §5.11。

## Requirements

### Requirement: 接口预留
系统 SHALL 定义 `PerceptionProvider` 接口（captureContext(): Promise<PerceptionFrame>，含来源/时间戳/内容类型），v1 SHALL 不提供任何实现，也不包含任何屏幕/摄像头采集代码路径。

#### Scenario: v1 零采集
- **WHEN** 审计 v1 全部包的源码与依赖
- **THEN** 不存在屏幕捕获、摄像头访问相关的 API 调用与权限声明

### Requirement: 配置占位
配置中心 SHALL 在「形象」或独立分区展示视觉感知占位项：灰显状态并说明「等待多模态模型可用」，不可开启。

#### Scenario: 占位可见不可用
- **WHEN** 打开配置中心对应分区
- **THEN** 视觉感知项灰显且带说明文案，无可交互开关
