## MODIFIED Requirements

### Requirement: provider seam 与自动降级
系统 SHALL 通过 `FriendTtsProvider` 注册表路由合成请求。内置降级链为**三级**：首选 provider → 其余已注册的非 browser 合成器 → browser 兜底。provider 故障 SHALL 只记录日志并降级，不打断会话、不弹阻塞错误。

browser 兜底 SHALL 向 client 下发指令，形状为 `{ kind: 'browser-fallback', engine: 'speechSynthesis', text, voice?, rate?, pitch?, uiHint: 'fallback', reason, failedProviders }`（证据：`packages/dsh-friend-tts/src/providers/browser.ts`）。client 半区 SHALL 按该形状对齐；`uiHint: 'fallback'` 对应 UI「兜底中」标记。

#### Scenario: 断网自动兜底
- **GIVEN** 默认 Edge 线路不可达
- **WHEN** 伴侣回复触发朗读
- **THEN** 本次朗读改走浏览器本地合成，UI 显示「兜底中」标记，会话流不受影响

#### Scenario: 首选失败后尝试其余 provider
- **GIVEN** 首选 edge 失败且 openai-compat 已注册
- **WHEN** 伴侣回复触发朗读
- **THEN** 系统接着尝试 openai-compat；仅当其余已注册合成器均失败时才下发 browser-fallback 指令

#### Scenario: 切换 provider 免重启
- **WHEN** 在设置中把 provider 从 edge 改为 openai-compat
- **THEN** 下一次合成即走新 provider，无需重启 dsh

#### Scenario: 兜底指令形状
- **WHEN** 全部合成器失败或配置为 browser
- **THEN** 返回指令的 `kind` 为 `browser-fallback`，`engine` 为 `speechSynthesis`，`uiHint` 为 `fallback`，并包含 `reason` 与 `failedProviders`

### Requirement: 零 key 默认线路
系统 SHALL 默认使用 Edge 阅读语音线路（默认音色 `zh-CN-XiaoxiaoNeural`），不要求用户提供任何 API key。协议依赖（含 WSS 传输）SHALL 锁定精确版本（当前传输层为 `ws@8.21.3`）；SHALL NOT 把「优先采用现成 npm 语音实现并锁其版本」当作硬性要求——现成包过重或许可不兼容时允许自实现协议。设置命名空间 SHALL 为 kebab 的 `friend-tts`（rc.6 `settingsNamespace()` 正则不接受点号；禁止 `friend.tts`）。

#### Scenario: 安装即有声
- **GIVEN** 全新安装且未配置任何 key
- **WHEN** 伴侣产生第一条回复
- **THEN** 中文语音正常播放

#### Scenario: 命名空间合法
- **WHEN** 校验 TTS 设置命名空间常量
- **THEN** 其值为 `friend-tts` 且匹配 `/^[a-z][a-z0-9-]*$/`

### Requirement: key 安全
系统 SHALL 将 openai-compat 线路的 API key 仅保存在 host 侧 `friend-tts` 配置，由 host 闭包在合成时读取。`synthesize` 的 opts SHALL NOT 携带 `apiKey`（证据：`packages/dsh-friend-tts/src/seam.ts` 的 `FriendTtsSynthesizeOpts`；`packages/dsh-friend-tts/test/openai.test.ts`）。任何 client 可读配置、网络响应与日志中 SHALL 不出现 key 明文。

client 半区 SHALL 只读取 decode 后的 settings `value`（经 host 消毒、无密文字段，可保留 `hasApiKey` 布尔）；SHALL NOT 把 `settingsScope.base` / `user` 原始文档当作可展示配置。若 dsh 把整个 `friend-tts` namespace 同步给 client、原始文档仍含密文，升级路径见本 change `proposal.md` 决策 G5（默认 G-A，待确认）。

#### Scenario: 泄漏检查
- **WHEN** 审计配置中心网络请求与 client 侧配置快照
- **THEN** 其中不含 key 字符串

#### Scenario: opts 不含 key
- **WHEN** 调用 openai-compat `synthesize`
- **THEN** 传入 opts 对象不含 `apiKey` 字段，请求 JSON body 亦不含 `apiKey`

### Requirement: 队列与缓存
系统 SHALL 以并发上限 3、按会话保序的队列执行合成；结果按 `provider+voice+rate+pitch+format+model+text` 哈希缓存（LRU 500 条 / TTL 1 小时，落盘 `cache/tts/`）——改语速、音调、格式或模型 SHALL 视为不同缓存条目，避免播旧音频（证据：`packages/dsh-friend-tts/src/cache.ts`）。音频经**前缀路由** `/friend/tts/audio`（`kind: 'prefix'`）提供，音频 id 由 handler 从 pathname 解析——rc.6 的 `WebRoute` 只有 `exact` / `prefix` 两种匹配，不支持 `:param` 占位符。handler SHALL 只接受 GET，其余 method 返回 405。

#### Scenario: 缓存命中
- **WHEN** 同一句话在相同 provider/voice/rate/pitch/format/model 下第二次触发朗读
- **THEN** 不再请求 provider（日志证明命中），播放正常

#### Scenario: 改语速不命中旧缓存
- **GIVEN** 某句已按默认语速缓存
- **WHEN** 仅改语速后再次朗读同一句
- **THEN** 缓存不命中，重新合成

#### Scenario: 顺序保证
- **WHEN** 连续 5 条回复入队
- **THEN** 播放顺序与生成顺序一致

#### Scenario: 音频按 id 取回
- **WHEN** 请求 `GET /friend/tts/audio/<id>`
- **THEN** 返回该 id 对应的音频；未知 id 返回 404；非 GET 返回 405

### Requirement: 播放、打断与口型输出
client 播放器 SHALL 顺序播放队列音频。存在两套停止面：`speechSynthesis` 执行器的 `stopAll()`（W-M2-4）与 AudioContext 播放器的 `stopAll()`（W-M2-7）。对外打断入口 SHALL 是一层门面，同时停止两边，调用后 100 ms 内静音并清空队列。ASR barge-in（W-M3-4）SHALL 调用该门面，而不是只停其中一路。音量与静音控制 SHALL 立即生效；并以约 30 Hz 输出能量包络（RMS）供 stage 口型驱动；browser 兜底路径 SHALL 用 boundary 事件近似输出。

#### Scenario: 立即打断
- **GIVEN** 长句正在播放（无论走 AudioContext 还是 speechSynthesis）
- **WHEN** 调用门面 `stopAll()`（如用户开始说话）
- **THEN** 100 ms 内两路均静音且队列清空

#### Scenario: 试听
- **WHEN** 在设置中更换音色并点击试听
- **THEN** 立即以新音色播放固定例句

## ADDED Requirements

### Requirement: TTS host 的 Cordis inject
tts host 模块 SHALL 导出 `export const inject = ['webServer']`。访问 `ctx.webServer` 前未声明对应 inject SHALL 导致挂载失败（证据：冒烟 `cannot get property "webServer" without inject`；`packages/dsh-friend-tts/src/index.ts`）。

#### Scenario: 缺少 webServer inject
- **WHEN** tts host 读取 `ctx.webServer` 但 `inject` 不含 `webServer`
- **THEN** 抛出 `cannot get property "webServer" without inject`，插件树挂载失败
