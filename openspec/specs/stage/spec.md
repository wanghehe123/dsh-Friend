# stage Specification

## Purpose

形象舞台：Live2D 渲染、合规资产下载、模型管理、页面悬浮层与气泡快捷聊天、表情标签协议与表演工具、口型同步、独立 pet 页。对应迁移计划 §5.5 与 §5.6，工作项 W-M4-*。

## Requirements

### Requirement: Live2D 渲染
系统 SHALL 在悬浮层与 pet 页渲染 Live2D 模型：待机状态有眨眼与呼吸物理，页签不可见（visibilitychange）时暂停渲染循环，帧率上限可配（默认 30）。

#### Scenario: 待机与省电
- **WHEN** pet 页加载完成且无交互
- **THEN** 模型待机动画运行；切走页签后渲染暂停，CPU 占用显著下降

### Requirement: 合规资产下载
系统 SHALL 不在 npm 包内嵌 Live2D Cubism Core 与示例模型；首次启用形象时从官方源下载 Cubism Core 与占位模型（Hiyori）及其 NOTICE 到 `vendor/`，经 sha256 校验后落盘，进度经 SSE 推送，失败可重试；静态服务 SHALL 防路径穿越。

#### Scenario: 首启下载
- **GIVEN** 全新数据目录
- **WHEN** 用户首次启用形象
- **THEN** 进度条完成后模型出现，`vendor/` 含 NOTICE 文件

#### Scenario: 发布物零内嵌
- **WHEN** 审计已发布 npm tarball
- **THEN** 不含 live2dcubismcore 与任何 Hiyori 素材文件

### Requirement: 模型管理
系统 SHALL 支持上传 zip 自定义模型：校验必须包含 `*.model3.json`、防 zip-slip、大小上限 200 MB；解压至 `models/<name>/`；表情映射读取 `friend.map.json`，缺失时扫描模型清单自动生成默认映射；删除当前模型 SHALL 自动回退占位模型。

#### Scenario: 上传即用
- **WHEN** 上传一个合法模型 zip 并在下拉中选中
- **THEN** 悬浮层立即渲染新模型

#### Scenario: 恶意 zip 拒绝
- **WHEN** 上传含 `../` 路径条目的 zip
- **THEN** 导入被拒绝且不产生任何越界文件

### Requirement: 悬浮层
系统 SHALL 在 dsh web UI 提供悬浮形象层：可拖拽、四角缩放、位置尺寸持久化、右键菜单（静音/隐藏/切换监听/打开配置中心）；检测到 dsh-pet 等已有桌宠挂载时 SHALL 默认换角避让。

#### Scenario: 位置持久化
- **WHEN** 拖动悬浮层到左上角后刷新页面
- **THEN** 悬浮层仍在左上角

#### Scenario: 与 dsh-pet 共存
- **GIVEN** dsh-pet 已挂载右下角
- **WHEN** friend 悬浮层首次出现
- **THEN** 两者不重叠

### Requirement: 气泡快捷聊天
悬浮层 SHALL 提供气泡：流式显示伴侣当前回复摘要、快捷输入框（回车经常驻会话发送）、打字指示、超时自动收起（可配）。

#### Scenario: 气泡对话
- **WHEN** 在气泡输入「你好」
- **THEN** 气泡流式显示回复，且主会话页同步出现同一条消息

### Requirement: 表情标签协议
系统 SHALL 流式解析回复中的 `[expr:<标准词表7词>]`、`[motion:<组名>]`、`[cue:<演出名>]` 标签（含跨 chunk 断裂缓冲），标签驱动舞台表演；屏幕显示文本与朗读文本 SHALL 零标签泄漏；非法标签按原文透传显示。

#### Scenario: 跨 chunk 断裂标签
- **WHEN** 流式输出把 `[expr:happy]` 拆成 `[ex` 与 `pr:happy]` 两个 chunk
- **THEN** 表情正确切换且屏幕与语音均不出现标签残片

### Requirement: 表演工具
系统 SHALL 注册 `set_expression` / `play_motion` / `play_cue` 三个工具（zod 校验，表情限标准词表），仅进入伴侣预设白名单；工具执行经推送通道驱动舞台，端到端生效 ≤ 500 ms。

#### Scenario: 模型主动表演
- **WHEN** 对伴侣说「做个开心的表情」
- **THEN** 会话流出现工具调用且悬浮层表情在 500 ms 内切换

### Requirement: 口型同步
系统 SHALL 用 TTS 能量包络驱动模型嘴参数（参数 id 来自 `friend.map.json`，默认 `ParamMouthOpenY`，含 attack/release 平滑）；无嘴参数的模型 SHALL 不报错；静音时嘴闭合。

#### Scenario: 说话开合
- **WHEN** Edge TTS 播放一句话
- **THEN** 口型随音节起伏，播放结束后嘴闭合

### Requirement: 独立 pet 页
系统 SHALL 提供 `GET /friend/pet` 极简页面（无 dsh GUI 外壳）：包含形象、气泡与语音输入；`?transparent=1` 时背景透明；SSE 断连 SHALL 自动重连并显示失联角标。

#### Scenario: 独立窗口完整可用
- **WHEN** 在浏览器独立窗口打开 `/friend/pet`
- **THEN** 说话、收听、表情全部可用；带 `?transparent=1` 时背景透明
