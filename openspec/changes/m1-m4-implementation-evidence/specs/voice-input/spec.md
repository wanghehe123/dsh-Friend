## MODIFIED Requirements

### Requirement: 引擎抽象与能力上报
系统 SHALL 通过 `AsrEngine` 接口（start/stop/onPartial/onFinal/capabilities）承载识别引擎。默认 `webspeech` 引擎的产品决策为 **Web Speech 只信 Chromium**（Chrome / Chromium / CriOS / Edg）：非 Chromium 的 Safari 即便存在 `webkitSpeechRecognition`，`capabilities()` SHALL 仍上报不可用并附带改用 endpoint 的原因，且不抛异常（提案决策 H-A，待确认；证据：`packages/dsh-friend-asr/src/engines/webspeech.ts` 的 `isNonChromiumSafari`）。无 `SpeechRecognition` 的 WebView SHALL 同样如实上报不可用。引擎选择「自动」时 SHALL 按 webspeech → endpoint 的顺序择先可用者。

#### Scenario: Chrome 正常识别
- **GIVEN** Chrome 且已授权麦克风
- **WHEN** 用户说一句中文
- **THEN** `onFinal` 返回对应文本并发送给伴侣

#### Scenario: 不支持环境如实上报
- **WHEN** 在无 `SpeechRecognition` 的 WebView 中查询能力
- **THEN** `available=false` 且附带原因，页面不报错

#### Scenario: Safari 即使有 webkit 前缀也不可用
- **GIVEN** 非 Chromium Safari 且存在 `webkitSpeechRecognition`
- **WHEN** 查询 webspeech `capabilities()`
- **THEN** `available=false` 且原因说明 Safari 不在支持范围，页面不报错

### Requirement: 页面内快捷键
系统 SHALL 提供可配置快捷键（默认 `Alt+S`）：录制式改键、冲突检测（命中即拒绝并提示）、改键即时生效并持久化；输入框聚焦时按住模式 SHALL 仍可用。

冲突表 SHALL 以官方插件可查询的 dsh 快捷键表为准；rc.6 **没有**该表时 SHALL 使用内置的保守浏览器保留键 + dsh 常用键黑名单（证据：`packages/dsh-friend-asr/src/hotkey.ts`）。官方表一旦可查询，内置表 SHALL 让位。

#### Scenario: 改键并持久化
- **WHEN** 用户把热键录制为 `Alt+Q`
- **THEN** 新键立即可用，刷新后仍为 `Alt+Q`

#### Scenario: 冲突拒绝
- **WHEN** 用户尝试把热键设为 `F5`
- **THEN** 设置被拒绝并显示冲突原因

### Requirement: 说话打断朗读
系统 SHALL 在进入 listening 状态时，若 bargeIn 开关开启（默认开），调用 `onBargeIn` 回调。真正停止 TTS 播放（voice-output 门面 `stopAll()`，同时停 `speechSynthesis` 与 AudioContext）SHALL 由 W-M3-4 把该回调接到门面完成——ASR 本能力在接线前只保证回调被触发，不直接依赖某一路播放器。

#### Scenario: 边听边打断
- **GIVEN** 伴侣语音正在播放且 bargeIn 开启、W-M3-4 已把门面接到 `onBargeIn`
- **WHEN** 用户按住说话进入 listening
- **THEN** `onBargeIn` 被调用一次且播放立即停止；关闭 bargeIn 后不调用、也不停止
