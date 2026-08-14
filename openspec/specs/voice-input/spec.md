# voice-input Specification

## Purpose

语音输入（ASR）：引擎抽象（默认 Web Speech API，零下载零 key）、按住/切换/自动监听三模式、页面内快捷键、说话打断 TTS、OpenAI 兼容 endpoint 引擎与环境自检。对应迁移计划 §5.4，工作项 W-M3-*。

## Requirements

### Requirement: 引擎抽象与能力上报
系统 SHALL 通过 `AsrEngine` 接口（start/stop/onPartial/onFinal/capabilities）承载识别引擎；默认 `webspeech` 引擎在不支持的环境 SHALL 通过 `capabilities()` 如实上报不可用而不抛异常；引擎选择「自动」时 SHALL 按 webspeech → endpoint 的顺序择先可用者。

#### Scenario: Chrome 正常识别
- **GIVEN** Chrome 且已授权麦克风
- **WHEN** 用户说一句中文
- **THEN** `onFinal` 返回对应文本并发送给伴侣

#### Scenario: 不支持环境如实上报
- **WHEN** 在无 `SpeechRecognition` 的 WebView 中查询能力
- **THEN** `available=false` 且附带原因，页面不报错

### Requirement: 三种收音模式
系统 SHALL 提供三种模式且模式逻辑独立于引擎：按住说话（按下开始、松开结束并发送）、切换（按一下开始、再按结束）、自动监听（持续识别，静默超过阈值——默认 1.2 s，可配——自动定稿发送）。

#### Scenario: 按住说话
- **WHEN** 按下热键说「今天天气不错」后松开
- **THEN** 该文本作为一条消息发送

#### Scenario: 自动监听静默定稿
- **GIVEN** 自动监听开启
- **WHEN** 用户说完一句并静默 1.2 s
- **THEN** 该句自动发送；用户继续说话时不误定稿

### Requirement: 页面内快捷键
系统 SHALL 提供可配置快捷键（默认 `Alt+S`）：录制式改键、与 dsh 已知快捷键及浏览器保留键的冲突检测（命中即拒绝并提示）、改键即时生效并持久化；输入框聚焦时按住模式 SHALL 仍可用。

#### Scenario: 改键并持久化
- **WHEN** 用户把热键录制为 `Alt+Q`
- **THEN** 新键立即可用，刷新后仍为 `Alt+Q`

#### Scenario: 冲突拒绝
- **WHEN** 用户尝试把热键设为 `F5`
- **THEN** 设置被拒绝并显示冲突原因

### Requirement: 说话打断朗读
系统 SHALL 在进入 listening 状态时调用 TTS `stopAll()`（bargeIn 开关，默认开启）。

#### Scenario: 边听边打断
- **GIVEN** 伴侣语音正在播放
- **WHEN** 用户按住说话
- **THEN** 播放立即停止；关闭 bargeIn 后不再停止

### Requirement: endpoint 引擎
系统 SHALL 提供 endpoint 引擎：client 用 MediaRecorder 采集音频上传 `POST /friend/asr/transcribe`，host 转发到用户配置的 OpenAI 兼容 `/audio/transcriptions` 端点；API key 仅存 host，超时 60 s，错误规范化返回。

#### Scenario: 壳内可用
- **GIVEN** 无 Web Speech 的桌面壳环境且已配置 whisper 兼容端点
- **WHEN** 按住说话
- **THEN** 识别结果正常发送，host 日志无 key 明文

### Requirement: 环境自检
设置分区 SHALL 显示各引擎在当前环境的可用性（可用/不可用 + 原因），并在均不可用时给出降级指引文案。

#### Scenario: 自检呈现
- **WHEN** 在 Chrome 打开语音输入设置
- **THEN** webspeech 显示可用；在桌面壳中打开则显示不可用及配置 endpoint 的指引
