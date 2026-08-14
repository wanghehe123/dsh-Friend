# Tasks

## 1. 已完成的代码修复（本轮）

- [x] 1.1 删除全部 8 份 `own()`（`hasOwnProperty` 探测 Cordis 服务），改为 `inject` + 直接读 `ctx.<service>`
  - 验收：真实实例 `POST /friend/stage/chat` 从 503 变为可达（不再是「persona agents missing」）
  - 回链：W-M1-5、W-M1-6、W-M4-5、W-M8-3
- [x] 1.2 补齐四个包 `inject` 缺失项（tts / asr / stage 的 `settings`，stage 的 `agents`，persona 的 `agents` + `settings`，growth / memory / settings 的 `agentDefaultModel`）
  - 验收：冒烟里对应包仍全部 `plugin-mount`（inject 满足、未 PENDING）
  - 回链：W-M0-6
- [x] 1.3 对齐真实 agent / settings 运行时形状（`create()` 返回 `{ agent, dispose }`；`update` 保住 receiver）
  - 验收：`POST /friend/stage/chat` → **200**，`sent: true`、`sessionId` 非空
  - 回链：W-M1-5、W-M4-5
- [x] 1.4 生产路径注册全部设置命名空间（shared 运行时引入 schemastery，8 个包各注册一次）
  - 验收：启动日志 `grep 'is not registered'` 命中数为 0；同一 `DSH_HOME` 重启后 `sessionId` **不变**
  - 回链：W-M8-3、W-M1-5
- [x] 1.5 接通 TTS host→client 音频通道与口型派发
  - 验收：真实浏览器 Network 出现 `GET /friend/tts/audio/<id>` 200 且有字节；`dsh-friend:lipsync` 能量序列非空
  - 回链：W-M2-2、W-M2-4、W-M2-7、W-M4-8
- [x] 1.6 memory / growth 接上 `ctx.llm.stream()`，删除抛错桩作为生产默认
  - 验收：`POST /friend/memory/distill` 的失败信息是官方 `dsh-llm MISSING_CREDENTIAL`，**不是**自家抛错桩
  - 回链：W-M5-5、W-M5-6、W-M7-1、W-M7-2、W-M7-3
- [x] 1.7 memory host 侧真订阅 `session/event` 的 `turn/end` 驱动自动小结；定时器与订阅走 `ctx.effect`
  - 验收：host 分支 disposer 经 fiber 释放，重载不泄漏定时器
  - 回链：W-M5-5、W-M5-6
- [x] 1.8 修 reactions 事件链路：按官方 `(session, event)` 签名订阅；词表对齐真实 `SessionEventMap`；删除 `tool-long` / `plan-approved`
  - 验收：真实实例 `GET /friend/reactions/latest` 的 `kind` 非空（改前恒 `{"empty":true}`）
  - 回链：W-M7-5、W-M7-6、W-M7-7
- [x] 1.9 ASR 识别结果落地（client 默认 `onSend` → `POST /friend/stage/chat`）；pet 页补 `settingsScope`
  - 验收：浏览器抓到 `submitFinal` 触发的 POST 与 200 + `sessionId`；pet 页改热键/语言后 `Alt+S`/`zh-CN` → `Alt+Q`/`en-US`
  - 回链：W-M3-1、W-M3-2、W-M3-3、W-M3-6
- [x] 1.10 悬浮层 chrome 补真实 CSS（拖拽条 0→22px `cursor:grab`；四个缩放角从横排 static 变为四角 absolute + resize cursor）
  - 验收：浏览器门禁量测真实几何通过
  - 回链：W-M4-4
- [x] 1.11 静音/音量收敛到唯一真源 `friend-tts.*`，配置中心 / 悬浮菜单 / 托盘三入口汇聚，AudioContext 与 `speechSynthesis` 两条播放路径都被覆盖
  - 验收：`setMuted(true)` 后 `getMuted()` 为真且 `stopAll` 被调用
  - 回链：W-M6-4、W-M2-7、W-M2-8
- [x] 1.12 配置中心补齐死字段与死按钮：TTS 试听、openai 凭据（能填、读回脱敏）、角色下拉候选、模型视图、导入改 POST、三个页面入口、`useMemo` 依赖修正
  - 验收：试听 `POST /friend/tts/preview` 200 且拉到音频字节；导入是 `POST /friend/memory/import` 不再 405
  - 回链：W-M2-3、W-M2-8、W-M3-5、W-M5-8、W-M8-3、W-M8-5

## 2. 已完成的守卫与门禁（本轮）

- [x] 2.1 严格假 ctx 改为 Proxy `get` trap 暴露服务
  - 验收：临时改回 `hasOwnProperty` 写法时测试变红（已实证）
  - 回链：W-M0-2
- [x] 2.2 严格假 ctx 的服务方法改为依赖 `this`
  - 验收：临时改回解构写法时测试变红（已实证）
  - 回链：W-M0-2
- [x] 2.3 `package.json` 的 `dsh.client.inject` 与模块 `export const inject` 对齐守卫
  - 验收：人为改一处不一致时变红（已实证）
  - 回链：W-M0-2
- [x] 2.4 reactions 测试改走真实 `ctx.on` 订阅路径
  - 验收：临时改回 `handler(args[0])` 时变红（已实证）
  - 回链：W-M7-5
- [x] 2.5 浏览器门禁加真实功能断言（悬浮层几何 + cursor）
  - 验收：去掉 CSS 时变红并给出量到的数值，恢复后变绿（已实证）
  - 回链：W-M0-7、W-M4-4
- [x] 2.6 修 `scripts/release-scan.test.ts` 的 5s 超时（每例 shell 出去跑两次 `npm pack`，npm 启动开销超预算）
  - 验收：`pnpm test` 793 passed / 1 skipped，退出码 0
  - 回链：W-M0-7

## 3. 尚未闭环

- [ ] 3.1 四条待拍板决策 D1–D4（静音别名去留、growth preset 分支、`toolLongMs` 去留、openai-compat 回落策略）
  - 阻塞：需项目负责人拍板
- [x] 3.2 托盘静音的 Tauri 端单测已跑
  - 验收：`cd apps/friend-shell && cargo test` 60 passed。真机托盘点静音仍需人工跑 Tauri
  - 回链：W-M6-4
- [x] 3.3 pet 页热键录制写回 host
  - 验收：`POST /friend/settings/patch` 写 `friend-asr.hotkey` / `language`；同一 `DSH_HOME` 重启后 snapshot 仍是新值
  - 回链：W-M3-3
- [x] 3.4 试听 pin 的 provider 不再静默回落 edge
  - 验收：`synthesize(..., { provider: 'openai-compat' })` 失败时不走 edge；`POST /friend/tts/preview` 对不能履约的 pin 返回 422
  - 回链：W-M2-3、W-M2-8
- [x] 3.8 growth 进度写入不再 fire-and-forget
  - 背景：`void store.writeProgress` 与测试清理抢目录，约 1/5 的 `pnpm test` 因未处理 rejection 变红，生产里同样会打翻 Node
  - 验收：`emit` 改为 await；`progress.json` 在流水线返回前已落盘
- [x] 3.9 W-M5-8 CLI 入口
  - 验收：`node scripts/import-kokoro.mjs --from … --to …` 存在；缺文件非 0
- [ ] 3.5 CI 上的真 dsh + Chromium 门禁尚未在 GitHub Actions 上真跑过
  - 回链：W-M0-7
- [ ] 3.6 Live2D 真渲染验收（**阻塞在人工事项**）
  - 前置：由负责人接受 Live2D 官方许可条款后在 pet 页点「下载并启用 Live2D」，或用 Cubism Editor 从 `models/naiwa-live2d/layers/` 导出 `.moc3`
  - 回链：W-M4-2、W-M4-8
- [ ] 3.7 零 key 北极星闭环实测（**阻塞在人工事项**）
  - 前置：需要一个可用的 DeepSeek API key
  - 验收：说话 → 伴侣回答 → Edge TTS 出声 → 口型同步，首响 < 2s
  - 回链：W-M1-6、W-M2-2、W-M4-8
