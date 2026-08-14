# voice-output Specification

## Purpose

语音合成（TTS）：provider seam 与自动降级、零 key 的 Edge 默认线路、OpenAI 兼容自定义线路、浏览器 speechSynthesis 兜底、文本预处理、队列与缓存、client 播放与口型能量输出。对应迁移计划 §5.3，工作项 W-M2-*。

## Requirements

### Requirement: provider seam 与自动降级
系统 SHALL 通过 `FriendTtsProvider` 注册表路由合成请求，内置降级链（首选 provider 失败 → browser 兜底），provider 故障 SHALL 只记录日志并降级，不打断会话、不弹阻塞错误。

#### Scenario: 断网自动兜底
- **GIVEN** 默认 Edge 线路不可达
- **WHEN** 伴侣回复触发朗读
- **THEN** 本次朗读改走浏览器本地合成，UI 显示「兜底中」标记，会话流不受影响

#### Scenario: 切换 provider 免重启
- **WHEN** 在设置中把 provider 从 edge 改为 openai-compat
- **THEN** 下一次合成即走新 provider，无需重启 dsh

### Requirement: 零 key 默认线路
系统 SHALL 默认使用 Edge 阅读语音线路（默认音色 `zh-CN-XiaoxiaoNeural`），不要求用户提供任何 API key；协议实现依赖 SHALL 锁定精确版本。

#### Scenario: 安装即有声
- **GIVEN** 全新安装且未配置任何 key
- **WHEN** 伴侣产生第一条回复
- **THEN** 中文语音正常播放

### Requirement: key 安全
系统 SHALL 将 openai-compat 线路的 API key 仅保存在 host 侧配置，任何 client 可读配置、网络响应与日志中 SHALL 不出现 key 明文。

#### Scenario: 泄漏检查
- **WHEN** 审计配置中心网络请求与 client 侧配置快照
- **THEN** 其中不含 key 字符串

### Requirement: 朗读文本预处理
系统 SHALL 在合成前：剥离括号舞台指示与 `[expr:*]/[motion:*]/[cue:*]` 表情标签、按句切分、首句优先入队以降低首响延迟。

#### Scenario: 指示与标签不被朗读
- **WHEN** 回复文本为 `[expr:happy]你好呀（轻轻挥手）今天过得怎么样？`
- **THEN** 实际朗读文本为「你好呀今天过得怎么样？」

#### Scenario: 首响延迟
- **GIVEN** 缓存未命中
- **WHEN** 一条多句回复开始合成
- **THEN** 首句音频就绪时间 < 2 s（CI 环境放宽为 < 4 s）

### Requirement: 队列与缓存
系统 SHALL 以并发上限 3、按会话保序的队列执行合成；结果按 `provider+voice+text` 哈希缓存（LRU 500 条 / TTL 1 小时，落盘 `cache/tts/`）；音频经 `GET /friend/tts/audio/:id` 提供。

#### Scenario: 缓存命中
- **WHEN** 同一句话第二次触发朗读
- **THEN** 不再请求 provider（日志证明命中），播放正常

#### Scenario: 顺序保证
- **WHEN** 连续 5 条回复入队
- **THEN** 播放顺序与生成顺序一致

### Requirement: 播放、打断与口型输出
client 播放器 SHALL 顺序播放队列音频，提供 `stopAll()`（调用后 100 ms 内静音并清空队列）、音量与静音控制，并以约 30 Hz 输出能量包络（RMS）供 stage 口型驱动；browser 兜底路径 SHALL 用 boundary 事件近似输出。

#### Scenario: 立即打断
- **GIVEN** 长句正在播放
- **WHEN** 调用 `stopAll()`（如用户开始说话）
- **THEN** 100 ms 内静音且队列清空

#### Scenario: 试听
- **WHEN** 在设置中更换音色并点击试听
- **THEN** 立即以新音色播放固定例句
