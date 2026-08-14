# dsh-Friend v1 工作分解（WBS）

> 迁移计划（`docs/migration-plan.md`）§9 里程碑的逐点展开：**每个工作项 = 改动点 + 测试 + 验收标准**。
>
> - 工作项 ID：`W-<里程碑>-<序号>`；里程碑内按依赖排序。
> - 行为契约以 `openspec/specs/<capability>/spec.md` 为准，工作项标注 `spec:` 关联。
> - 测试分层：**unit**（vitest）/ **int**（集成：linked bundle 起 dsh 断言）/ **e2e**（playwright 冒烟）/ **manual**（人工操作步骤，写进对应包 README 的验证章节）。
> - 验收标准必须**二值可判定**；里程碑收口 = 该里程碑全部工作项验收通过 + 冒烟脚本绿。

---

## M0 骨架与探路

### W-M0-1 pnpm monorepo 骨架
- **改动点**：根 `package.json`（workspaces、scripts）、`pnpm-workspace.yaml`（`packages/*`、`apps/*`）、根 `tsconfig.base.json`、`shared/tsdown.client.ts` + `shared/web-platform.ts`（构建预设与平台模块表，仿 dsh-web-ui 单一共享副本）、`.npmrc`（`@deepseek-ai:registry` scope 映射）、`.gitignore`（dist、node_modules、`~` 类产物）。
- **测试**：unit——CI 步骤即测试：`pnpm install && pnpm -r build && pnpm -r typecheck` 在空包状态跑通。
- **验收**：全仓构建/类型检查 0 错误；仓库内 `rg "test-|\.dsh/source" --glob tsconfig*` 无任何指向 dsh 源码 checkout 的 paths/references。

### W-M0-2 包骨架生成与脚手架
- **改动点**：`scripts/dsh-plugin-new.mjs`（生成 host+client 双半区骨架：`cordis.patch.yml`、`package.json`（`dsh.bundle.patch` + `dsh.client`）、`src/index.ts`、`src/client.ts`、`tsconfig.json`、`tsdown.config.ts`、`README.md`）；用它生成 §4 的 10 个功能包 + `dsh-friend-shared`；`apps/friend-shell` 建占位目录。
- **测试**：unit——脚手架产物文件清单快照测试；生成包纳入 `pnpm -r build`。
- **验收**：`packages/` 与迁移计划 §4 包表一一对应；每个 client 半区包的 `dsh.client` 声明 `platform: "web"` 且构建出 `__ModuleLoader__` 可加载产物。

### W-M0-3 聚合包与漂移守卫
- **改动点**：`packages/dsh-friend-all/aggregate.yml`（patchFrom + deps 两段）、`scripts/aggregate.mjs`（重新生成聚合 `cordis.patch.yml` 与 `dependencies`；`--check` 校验模式）。
- **测试**：unit——对 fixture 仓库跑 aggregate 后快照比对；人为制造漂移断言退出码 1。
- **验收**：`node scripts/aggregate.mjs --check` 在干净树上退出码 0；新增包未注册聚合时 CI 失败。

### W-M0-4 link-profile 开发循环
- **改动点**：`scripts/link-profile.mjs`（把全部包构建产物链接进 `~/.dsh/profiles/node_modules/@<scope>/`，含 `--dry-run`）；`docs/dev-loop.md`（改码→build→刷新的标准循环、常见坑：npm 回退解析、缺 chunk 现象）。
- **测试**：manual——按 dev-loop.md 走一遍。
- **验收**：`dsh web` 启动日志出现全部 11 个插件挂载行；修改任一 client 半区代码后按文档步骤 ≤30 秒内可见变化。

### W-M0-5 dsh-compat 首版
- **改动点**：`dsh-friend-shared/src/dsh-compat.ts`——六类封装：`registerPreset`、`registerPromptSection`、`registerTool`、`registerRoute`、`pushToClient`（推送通道）、`bindSettings`（host `installSettingsSection` / client `settingsScope` 两端）。每个封装带 JSDoc 标注对应官方 API 与替换预案。
- **测试**：unit——mock ctx 断言每个封装的调用形状与 effect 释放（disposable 语义）；类型层用 `tsd` 式断言导出面稳定。
- **验收**：除 `dsh-friend-shared` 外，`rg "@deepseek-ai/" packages/*/src --glob '!*shared*'` 里出现的 import 仅限类型导入；运行时调用 100% 经 compat（lint 规则守卫）。

### W-M0-6 探路清单收敛
- **改动点**：`docs/m0-findings.md`——探路结论：① Agent 预设注册 API 形态；② 整页/路由级 client 槽位是否存在（决定配置中心走槽位还是全屏覆盖层）；③ host HTTP 路由注册 API；④ host→client 推送（官方 seam 或自建 SSE）；⑤ 官方 MCP 插件包名与配置格式（time 接线用）；⑥ **Cordis `inject` 硬性要求**（读 `ctx.<service>` 前必须模块级 `export const inject`，否则代理在读属性甚至 `=== undefined` 时抛错并拖垮插件树；两次冒烟：`agentPresets` / `webServer`）。每项记录：结论、采用方案、`dsh-compat` 落点、兜底方案。⑥ 的完整证据见 `openspec/changes/m1-m4-implementation-evidence/design.md`（本轮不改 findings 正文，归档后补）。
- **测试**：—（调研产物，但每项须附最小可运行验证片段或官方文档/源码出处）。
- **验收**：六项全部为「已确认」或「已选兜底」，无「未知」；`dsh-compat.ts` 与结论一致；host 访问的服务均出现在对应包的 `inject` 数组。

### W-M0-7 CI、canary 与冒烟脚本
- **改动点**：`.github/workflows/ci.yml`（install→build→typecheck→test→aggregate --check→host 冒烟→浏览器门禁）；`.github/workflows/canary.yml`（每周日用 `@deepseek-ai/*@latest` 重装构建，失败开 issue）；`scripts/smoke.mjs`：隔离 `DSH_HOME` 起 dsh → 断言挂载日志与 `GET /friend/pet` 200；`scripts/browser-smoke.mjs`：Playwright 打开客户端根路径，断言页面无 `Failed to load plugins` 且全部 client 半区加载。host 挂载行与路由 200 **不是**客户端半区可用的证据。
- **测试**：CI 自身在 PR 上绿一次；canary 手动 `workflow_dispatch` 一次成功；人为把某包 client 改回读未声明 ctx 属性时 `browser-smoke` 变红并指名到包。
- **验收**：主干必须绿才可合并（分支保护）；`node scripts/smoke.mjs` 退出码 0；浏览器级门禁页面无 `Failed to load plugins`。

---

## M1 伴侣会话

### W-M1-1 角色卡存储（persona store）
- **改动点**：`dsh-friend-persona/src/store.ts`——`characters/<slug>/persona.json` 的 CRUD；zod schema（name/personality/background/speakingStyle/language/nickname/greetings/live2dModel/voice/tags）；slug 生成与冲突处理；内置默认角色种子（首启写入）。
- **测试**：unit——CRUD 往返、schema 拒绝非法卡、slug 冲突自动后缀、默认角色幂等种子。
- **验收**：删除数据目录后首启自动出现默认角色；手工编辑 persona.json 后重载生效（`onChange` 通路）。

### W-M1-2 酒馆卡导入
- **改动点**：搬迁旧仓 `src/lib/character-card-parser.ts` → `dsh-friend-persona/src/tavern-import.ts`；支持 SillyTavern PNG（tEXt chunk）与 JSON 两路；字段映射到 persona schema（缺省字段回退策略）。
- **测试**：unit——旧仓测试用例直迁 + 新增字段映射用例（V2 卡规范样例 fixture）。
- **验收**：旧仓测试集通过率 100%；导入一张真实酒馆卡后人设对话可用。

### W-M1-3 人格 section
- **改动点**：`dsh-friend-persona/src/sections.ts`——经 compat 注册系统提示词分区：人格（persona 渲染 + `beliefs.md` 若存在）+ 行为守则（表情标签协议、记忆记录守则、语言约束）；scope 仅限伴侣预设会话。
- **测试**：unit——给定 persona fixture 断言渲染文本（快照）；scope 掩码：非伴侣 preset 的组装结果不含人格区（mock 组装管线；rc.6 无进程外 inspect）。
- **验收**：int——真实伴侣会话首条系统提示词含角色名与守则。unit——mock 组装管线：非伴侣 preset 组装结果不含任何 friend 分区。manual——同 profile 打开 dsh 默认编码会话，抽查提示词不含 friend 分区（rc.6 无法进程外枚举；等官方提供查询能力后升级为自动断言）。

### W-M1-4 双预设注册
- **改动点**：`dsh-friend-persona/src/presets.ts`——`friend-companion`（restrict 工具白名单：memory 三件、表演三件、notify、time）与 `friend-companion-plus`（追加 dsh 网页搜索、文件只读）。
- **测试**：unit——白名单集合断言；plus 是 companion 的超集；restrict 在 companion-preset 角色上调用（rc.6 无进程外 `tools.schemas` inspect；常驻挂载在第一次有会话使用该预设时才 `ensureStanding`）。
- **验收**：unit——allowlist 与白名单完全一致，bash/文件写入不在集合内。int——真实 companion 会话中触发一次白名单内工具（行为验收）。manual——抽查编码会话看不到伴侣白名单工具（等官方提供查询能力后改为「session 事件里核对 tool schema 数量」的自动断言）。

### W-M1-5 常驻会话管理
- **改动点**：`dsh-friend-persona/src/session.ts`——`getOrCreateCompanionSession()`：会话 id 持久化于 `friend.core` 配置；失效自动重建；`sendToCompanion(text)` 封装 followup。
- **测试**：unit——id 缺失/失效/正常三分支（mock agents registry）。
- **验收**：int——重启 dsh 后气泡快捷输入仍续写同一会话（session id 不变）；删除该会话后下次输入自动新建且不报错。

### W-M1-6 模型继承与按用途 override
- **改动点**：`dsh-friend-shared/src/model-select.ts`——`resolveModel(purpose: 'chat'|'summarize'|'growth')`：默认返回 dsh 当前模型；`friend.persona.chatModel` / `friend.memory.summarizeModel` / `friend.growth.model` 可覆写（值为已注册模型 id 或 OpenAI 兼容端点配置）。
- **测试**：unit——三种 purpose 的回退链（override → dsh 默认）；非法 override 回退默认并告警。
- **验收**：int——不做任何模型配置时伴侣可对话（继承验证）；将 summarize 覆写为另一模型后，自动小结请求走该模型（日志断言）。

---

## M2 语音输出

### W-M2-1 TTS Service seam 与注册表
- **改动点**：`dsh-friend-tts/src/seam.ts`——`FriendTtsProvider { id; listVoices(); synthesize(text, opts): Promise<{audio: Buffer; mime: string}> }`；注册表（注册/注销为 effect）；`router.ts` 按配置选 provider 并处理失败降级链（edge → browser 标记）。
- **测试**：unit——注册表生命周期；降级链：首选抛错时返回 browser 兜底指令。
- **验收**：配置切换 provider 无需重启即生效；provider 抛错不打断会话（错误仅记日志 + 兜底）。

### W-M2-2 edge provider
- **改动点**：`dsh-friend-tts/src/providers/edge.ts`——Edge 阅读语音 WSS 协议（优先采用现成 npm 实现并**锁精确版本**）；音色/语速/音调参数；默认 `zh-CN-XiaoxiaoNeural`。
- **测试**：unit——请求报文构造与参数映射（协议层 mock）；int（可跳过标记 `EDGE_LIVE=1` 才跑）——真实合成一句并断言音频头。
- **验收**：manual——零 key 环境合成中文一句可播放；断网时降级链触发（W-M2-1）而非报错弹窗。

### W-M2-3 openai-compat provider
- **改动点**：`dsh-friend-tts/src/providers/openai.ts`——`POST {base}/audio/speech`；key 仅存 host settings，永不下发 client；超时与错误规范化。
- **测试**：unit——用本地 mock server 断言请求头/体与音频透传；key 不出现在任何 client 可读配置（专项断言）。
- **验收**：配置自建端点后可合成；`GET` 配置中心网络面板检查无 key 泄漏。

### W-M2-4 browser 兜底 provider
- **改动点**：`dsh-friend-tts/src/providers/browser.ts`（host 侧仅返回「client 本地合成」指令）+ client 半区 `speechSynthesis` 执行器（音色枚举、boundary 事件上报供口型近似）。
- **测试**：unit——指令流转；client 执行器在 jsdom 下用 `speechSynthesis` stub 断言调用序列。
- **验收**：manual——强制选 browser provider 后回复有声；edge 拉闸场景（mock 断网）自动落到此路且 UI 提示「兜底中」。

### W-M2-5 队列、缓存与音频路由
- **改动点**：`dsh-friend-tts/src/queue.ts`（并发上限 3、按会话顺序保序、可清空）；`cache.ts`（key = provider+voice+text hash；LRU 500 条 / TTL 1h；落盘 `cache/tts/`）；compat 路由 `GET /friend/tts/audio/:id`（Range 不需要，一次性 mp3）。
- **测试**：unit——并发窗口、保序、清空语义；缓存命中/过期/容量淘汰；路由 404/200。
- **验收**：同一句话第二次播放不再请求 provider（日志断言缓存命中）；连续 5 条回复播放顺序与生成顺序一致。

### W-M2-6 文本预处理
- **改动点**：`dsh-friend-tts/src/prepare.ts`——搬迁旧仓「括号舞台指示剥离」与句切分；剥离 §5.6 表情标签；首句短路策略（首句先入队降低首响）。
- **测试**：unit——**旧仓用例直迁全绿** + 新增：`[expr:happy]你好（挥手）` → 朗读文本为「你好」；中英混排切句边界。
- **验收**：含括号与标签的回复，试听音频与显示文本均不含指示与标签；首响（首句音频就绪）在缓存未命中时 < 2 s（int 计时断言，CI 放宽为 < 4 s）。

### W-M2-7 client 播放器与口型能量泵
- **改动点**：搬迁旧仓 `src/lib/audio-player.ts`（连测试）→ client 半区；AudioContext 播放 + AnalyserNode 能量包络（RMS，30 Hz 采样）经回调供 stage；打断接口 `stopAll()`；音量/静音接配置。
- **测试**：unit——旧测试直迁全绿；能量泵对合成正弦波 fixture 输出单调包络（web-audio mock）。
- **验收**：播放中调用 `stopAll()` 100 ms 内静音且队列清空；静音开关立即生效。

### W-M2-8 试听与 TTS 设置
- **改动点**：client 设置组件：provider 选择、音色下拉（`listVoices`）、语速/音调滑条、自动朗读开关、「舞台指示不朗读」开关、试听按钮（固定例句）。
- **测试**：unit——表单状态与 settingsScope staged 提交（stub）；e2e 冒烟点一次试听。
- **验收**：改音色→试听立即用新音色；全部项改动不需重启。

---

## M3 语音输入

### W-M3-1 AsrEngine 抽象与 webspeech 实现
- **改动点**：`dsh-friend-asr/src/engine.ts`——`AsrEngine { start(mode); stop(); onPartial; onFinal; capabilities() }`；`engines/webspeech.ts`（`SpeechRecognition`，`interimResults`、`continuous`、语言跟随配置；不可用时 `capabilities().available=false`）。
- **测试**：unit——用 SpeechRecognition stub 驱动 partial/final 事件序列；不可用环境的能力上报。
- **验收**：Chrome 下说一句话 `onFinal` 拿到中文文本；Safari/壳内 `capabilities()` 如实返回不可用（不抛异常）。

### W-M3-2 三模式状态机
- **改动点**：`dsh-friend-asr/src/modes.ts`——按住（keydown start / keyup stop 即发送）、切换（按一下开始/再按结束）、自动监听（continuous + 静默阈值默认 1.2 s 自动 final 发送）；状态机独立于引擎。
- **测试**：unit——三模式的事件序列驱动状态转移全覆盖（含快速连按、说话中切模式、引擎中途报错）。
- **验收**：三模式手册操作各成功 3 次；自动监听下静默 1.2 s 自动发送、继续说话不误切。

### W-M3-3 页面内快捷键
- **改动点**：`dsh-friend-asr/src/hotkey.ts`——默认 `Alt+S`；录制式改键 UI（捕获组合键、Esc 取消）；冲突检测（与 dsh 已知快捷键表 + 浏览器保留键黑名单）；输入框聚焦时按住模式仍可用（capture 阶段监听）。
- **测试**：unit——键盘事件 fixture：注册/触发/改键/冲突拒绝；黑名单命中提示。
- **验收**：改键为 `Alt+Q` 后立即生效且持久化；设置里显示当前键位；黑名单键（如 `F5`）被拒绝并给出提示。

### W-M3-4 打断 TTS 联动
- **改动点**：ASR 开始采音（三模式任一进入 listening）→ 调 tts `stopAll()`（可配开关 `bargeIn`，默认开）。
- **测试**：unit——listening 状态变迁触发一次且仅一次 stopAll；关掉开关后不触发。
- **验收**：manual——她说话时按住说话，语音立停；关闭打断后不再停。

### W-M3-5 endpoint 引擎（自定义 ASR）
- **改动点**：`engines/endpoint.ts`——MediaRecorder 采集 webm/opus → `POST /friend/asr/transcribe`；host 侧 `dsh-friend-asr/src/proxy.ts` 转发 OpenAI 兼容 `/audio/transcriptions`（multipart，key 不出 host，60 s 超时）。
- **测试**：unit——host 代理对 mock 端点的请求形状/错误规范化/超时；client 引擎状态机复用 W-M3-2 用例跑一遍。
- **验收**：配置 whisper 兼容端点后，壳内（无 Web Speech 环境）按住说话可用；host 日志无 key 明文。

### W-M3-6 引擎自检与 ASR 设置
- **改动点**：设置分区「语音输入」：引擎选择（含自动：webspeech 可用则用之，否则 endpoint）、当前环境可用性自检卡（绿/灰 + 原因）、模式选择、静默阈值、自动发送开关、语言。
- **测试**：unit——自检卡对三种 capabilities 组合的渲染；自动引擎选择逻辑。
- **验收**：Chrome 显示 webspeech 可用；壳内显示不可用并给出降级指引文案。

---

## M4 形象舞台

### W-M4-1 Live2D 渲染核搬迁
- **改动点**：旧仓 `src/features/live2d/` 五件（`Live2DController` / `Live2DViewer` / `LipSyncProcessor` / `DrawableHitTest` / `cubism-core-loader`）→ `dsh-friend-stage/src/client/live2d/`；Tauri 依赖剥离（`invoke`/`listen` 改为 props/事件回调）；`visibilitychange` 暂停 ticker；FPS 上限接配置。
- **测试**：unit——controller 对 mock 模型的参数写入序列；hit-test 几何用例直迁；loader 的 core 缺失报错路径。
- **验收**：pet 页加载占位模型待机（眨眼/呼吸物理）；页签切走 CPU 占用下降（手册对比 Activity Monitor）；FPS 上限 30 时帧回调频率 ≤ 31。

### W-M4-2 资产合规下载器
- **改动点**：`dsh-friend-stage/src/host/assets.ts`——首次启用时下载 Cubism Core 与 Hiyori（含 NOTICE）到 `vendor/`；sha256 校验；SSE `asset-progress`；失败可重试；`GET /friend/assets/*` 静态服务（路径穿越防护）。
- **测试**：unit——mock 下载：校验失败拒绝落盘、断点重试、进度事件序列；路径穿越请求 403。
- **验收**：全新数据目录首次启用 → 进度条走完 → 模型出现；`vendor/` 内 NOTICE.md 存在且「关于」页可见；npm 包 tarball **按文件**扫描：不存在 `.moc3` / `.model3.json` / `live2dcubismcore.min.js` 等专有文件（**不要**用全文 `rg live2dcubismcore`——`lib/pet.iife.js` 合法引用全局名 `Live2DCubismCore`，按字面必然误报）。

### W-M4-3 模型管理
- **改动点**：`host/models.ts`——上传 zip（`POST /friend/models/upload`）：解压校验（必须含 `*.model3.json`；zip-slip 防护；大小上限 200 MB）→ `models/<name>/`；列表/删除/当前模型切换；`friend.map.json` 表情映射（缺省时扫描模型 expressions/motions 自动生成默认映射）。
- **测试**：unit——合法/缺 model3/夹带路径穿越/超限 四类 zip fixture；默认映射生成器对 Hiyori 清单快照。
- **验收**：上传一个真实模型后下拉可选且立即渲染；删除当前模型自动回退占位模型不白屏。

### W-M4-4 悬浮层组件
- **改动点**：`client/FloatStage.tsx`——右下角悬浮：拖拽（pointer capture）、四角缩放、位置尺寸持久化（settingsScope）、右键菜单（静音/隐藏/切换监听/打开配置中心）、z-index 置顶；检测到 dsh-pet 挂载时默认换角（DOM 探测其容器）。
- **测试**：unit——拖拽/缩放的指针事件序列与持久化写入；避让逻辑两种场景。
- **验收**：拖到左上角刷新后位置不变；与 dsh-pet 共存时不重叠；隐藏后设置卡片可重新显示。

### W-M4-5 气泡快捷聊天
- **改动点**：`client/Bubble.tsx`——伴侣当前回复流式摘要（session/event 驱动）+ 快捷输入框（回车经 W-M1-5 发送）；打字指示；气泡超时自动收起（可配）。
- **测试**：unit——流式 chunk 驱动渲染快照；输入回车调用 sendToCompanion 一次。
- **验收**：在悬浮层输入「你好」，气泡出现流式回复且主会话页同步可见同一条消息。

### W-M4-6 表情标签解析器
- **改动点**：`src/tag-parser.ts`——流式安全解析 `[expr:*]` `[motion:*]` `[cue:*]`（跨 chunk 断裂标签缓冲）；剥离后文本供显示与 TTS；标签事件派发给 stage。搬迁旧仓标签解析与 `llm-thinking.ts`（思考块剥离，连测试）。
- **测试**：unit——旧用例直迁 + 跨 chunk 断裂（`[ex` + `pr:happy]`）、形态合法但词不在表内仍剥离不应用、形态非法透传、未闭合超过 48 字符当正文吐出、密集标签序列。
- **验收**：模型输出含标签的回复，屏幕文本/朗读文本零协议标签泄漏；词表内表情按标签顺序切换；未知词不驱动舞台。

### W-M4-7 表演工具三件
- **改动点**：`src/tools.ts`——`set_expression` / `play_motion` / `play_cue`（`defineTool` 的 `ParameterSchemaSpec` 属性表，**不是** zod：每项 `{ type, enum?, required?, description? }`，且 `output.schema` + `output.render` 必填；标准表情词表 7 词 / 组名 / 演出名）；执行 = 经 compat 推送 client；工具仅注册进伴侣预设白名单。
- **测试**：unit——参数校验拒绝词表外表情；推送 payload 形状。
- **验收**：int——伴侣会话里让她「做个开心的表情」，工具调用出现在会话流且悬浮层表情切换 ≤ 500 ms。unit——白名单/restrict 断言表演工具不进入非伴侣 scope。manual——抽查编码会话不可见这些工具（rc.6 无法进程外枚举预设工具列表；等官方提供查询能力后升级为自动断言）。

### W-M4-8 口型对接
- **改动点**：`client/lipsync-bridge.ts`——W-M2-7 能量包络 → `LipSyncProcessor` → 模型嘴参数（参数 id 来自 `friend.map.json`，默认 `ParamMouthOpenY`）；browser 兜底 provider 时用 boundary 事件近似。
- **测试**：unit——包络序列 → 参数写入的映射与平滑（attack/release）；无嘴参数模型不抛错。
- **验收**：manual——Edge TTS 播放时口型与音节起伏明显同步；静音时嘴闭合。

### W-M4-9 独立 pet 页
- **改动点**：compat 路由 `GET /friend/pet`——极简 HTML（无 dsh GUI chrome）：加载 stage client bundle + 气泡 + 语音输入；`?transparent=1` 输出透明背景（CSS + 无底色）；断连 SSE 自动重连与「失联」状态角标。
- **测试**：int——路由 200、HTML 引用的 bundle 可加载；透明参数快照（body background 断言）。
- **验收**：浏览器独立窗口打开 `/friend/pet` 功能完整（说话/听/表情）；`?transparent=1` 时 OBS/壳内背景透明。

---

## M5 记忆

### W-M5-1 MemoryStore 文件层
- **改动点**：`dsh-friend-memory/src/store.ts`——按 §3.4 布局读写：`MEMORY.md`（固定四分节解析/序列化、体积上限默认 8 KB）、`memory/YYYY-MM-DD.md`（条目 `- HH:mm [source] 内容`，追加原子写）、`USER.md`；月归档（`memory/archive/YYYY-MM/`）；蒸馏前滚动备份 `MEMORY.md.bak.N`（N ≤ 7）。
- **测试**：unit——分节解析往返、追加并发（两写者）、超限检测、归档搬移、备份轮转。
- **验收**：全部文件人类可读（抽查）；手工外部编辑 MEMORY.md 后下次注入内容为新值（无缓存脏读）。

### W-M5-2 MemoryRetriever 接口与 rg 实现
- **改动点**：`src/retriever.ts`——`MemoryRetriever { search(q): Hit[]; get(path, range): string; bootstrap(): BootstrapBundle }`；默认实现 `RgRetriever`：ripgrep 子进程（固定参数、无 shell 注入）覆盖 `MEMORY.md + memory/**/*.md + story.md`，Hit 含 path/行号/±2 行片段/简单评分（命中次数），上限 20。
- **测试**：unit——中文/英文/正则元字符 query（注入防护）、多文件排序、无命中空数组；接口契约测试套件（供未来 embedding 实现复用同一套）。
- **验收**：`search("生日")` 能命中三天前笔记里的「8 月 3 日生日」；query 含 `"; rm -rf"` 无副作用（参数化调用断言）。

### W-M5-3 记忆工具三件
- **改动点**：`src/tools.ts`——`memory_append({text, target: daily|longterm})`、`memory_search({query})`、`memory_get({path, from, to})`；path 白名单（仅数据目录内）；注册进伴侣预设。
- **测试**：unit——append 落盘位置正确（daily 带时间戳源标 `note`；longterm 进「重要事实」节）；get 越界 path 拒绝。
- **验收**：int——对伴侣说「记住我不吃香菜」，当日笔记出现该条；下一会话问「我忌口什么」，工具链（search→get）召回并答对。

### W-M5-4 bootstrap section
- **改动点**：`src/sections.ts`——记忆区注入：`MEMORY.md` 全文 + 今昨每日笔记 + `USER.md`；超预算截断策略（MEMORY 优先、笔记按时间倒序截断）；scope 限伴侣预设。
- **测试**：unit——三文件组合渲染快照；预算截断边界；文件缺失时优雅空段。
- **验收**：int——新会话系统提示词含昨日笔记条目；编码会话提示词不含记忆区。

### W-M5-5 会话自动小结
- **改动点**：`src/auto-summary.ts`——监听伴侣会话 `turn/end`，空闲去抖（默认 10 min，可配/可关）后调 `resolveModel('summarize')` 把增量对话压成 1-3 条事实（提示词改写自旧仓 `memory_extractor.rs`），写入当日笔记（source `chat`）；幂等（同一 turn 区间不重复小结）。
- **测试**：unit——去抖计时（fake timers）、增量水位线、LLM 返回空/超长/非法格式的容错、幂等。
- **验收**：int——对话后静置 10 min，当日笔记新增 `[chat]` 条目且与对话内容相符；关掉开关后不再产生。

### W-M5-6 夜间蒸馏 job
- **改动点**：`src/distill.ts`——默认每日 04:00（可配）+ 配置中心「立即归纳」按钮；流程：备份 → 读近 7 天笔记 + 现 MEMORY.md → LLM 重写四分节（新事实优先、矛盾标日期、体积回到上限内）→ 原子替换；失败恢复备份；结果通知（SSE）。
- **测试**：unit——**护栏用例集**（旧仓 AGENTS.md 清单平移）：不丢标注「重要」的事实、矛盾合并规则、超限压缩后关键条目仍在、LLM 输出损坏时回滚；调度触发（fake timers）。
- **验收**：手动触发一次蒸馏：MEMORY.md ≤ 上限、备份文件 +1、护栏断言全绿；蒸馏中断（kill 进程）重启后文件完好（原子性）。

### W-M5-7 记忆浏览器
- **改动点**：配置中心「记忆」分区：文件树（MEMORY/每日/USER/story）、Markdown 预览与编辑（保存经 host 校验写回）、搜索框（走 retriever）、「立即归纳」与开关项。
- **测试**：unit——编辑保存往返、搜索结果渲染；e2e 冒烟开一次页面。
- **验收**：在浏览器里改一条记忆并保存，`memory_get` 读到新值；搜索框结果与工具 `memory_search` 一致。

### W-M5-8 旧数据 importer
- **改动点**：`scripts/import-kokoro.mjs` + 配置中心按钮——按迁移计划 §7 表：只读打开 `kokoro.db`（better-sqlite3），memories→`memory/imported/YYYY-MM-DD.md`（源标 `import`）+ 高重要度汇总节；角色→persona.json；成长→story.md/beliefs.md；`user_profile.json`→USER.md；live2d_models 拷贝；pet_config 映射；产出迁移报告（计数+跳过原因）。
- **测试**：unit——对旧库 schema fixture（从真实库脱敏抽样）断言各表映射与计数；重复导入幂等（跳过已导入标记）。
- **验收**：对本机真实旧库跑通：报告计数与库内行数对上；导入后伴侣能答出旧记忆中的既有事实；旧库文件 mtime 不变（只读证明）。

---

## M6 桌面薄壳

### W-M6-1 壳工程与窗口
- **改动点**：`apps/friend-shell/`——Tauri 2 工程：单窗口 `transparent + alwaysOnTop + decorations:false + skipTaskbar(可配)`；加载 `{base}/friend/pet?transparent=1`；位置/尺寸持久化（`shell-config.json`，字段语义沿旧 `pet_config.json`）；八向缩放（旧 PetWindow 逻辑已在 pet 页内，壳仅透传窗口 resize）。
- **测试**：unit（rust）——配置读写与缺省值；manual——拖拽/缩放/重启复原。
- **验收**：macOS 上壳窗置顶于全屏外的所有应用、背景透明无白底；重启后位置尺寸误差 0。

### W-M6-2 连接探测与引导页
- **改动点**：启动探测 `{base}/friend/pet` 可达性（3 s 超时，重试退避）；不可达显示本地引导页：一键复制 `npx @deepseek-ai/dsh web`、重试按钮、「由壳代启动 dsh」开关（默认关，开启则 spawn 并托管子进程日志）。
- **测试**：unit（rust）——探测状态机（可达/不可达/恢复）；manual——先开壳后开 dsh，自动从引导页切入 pet 页。
- **验收**：dsh 未启动时壳不白屏不崩溃；dsh 启动后 ≤ 5 s 自动恢复。

### W-M6-3 全局快捷键
- **改动点**：`tauri-plugin-global-shortcut`——显隐 `CmdOrCtrl+Shift+Space`、按住说话 `CmdOrCtrl+Shift+M`（Pressed 开始 / Released 结束，注入 pet 页触发 W-M3-2 状态机；切换模式亦可配）；改键经配置中心（壳轮询配置或 SSE）。
- **测试**：unit（rust）——注册/注销/改键重注册（沿旧 `pet.rs` 逻辑直译的用例）；manual——前台是其他 App 时两条快捷键均生效。
- **验收**：在 IDE 前台按住 `Cmd+Shift+M` 说话，松开后伴侣收到消息并回复；连按显隐 10 次无重复注册报错。

### W-M6-4 托盘与自启
- **改动点**：托盘菜单：显示/隐藏、静音、打开配置中心（默认浏览器开 dsh 设置页）、退出；`tauri-plugin-autostart` 开机自启（默认关）。
- **测试**：manual——菜单四项各验证一次；开自启后注销重登壳自动拉起。
- **验收**：托盘图标常驻；退出后无残留进程（`ps` 断言）。

### W-M6-5 点击穿透
- **改动点**：非交互区（模型透明像素外）`setIgnoreCursorEvents(true)` 动态切换（pet 页把命中区变化推给壳）；配置开关。
- **测试**：manual——穿透开：点模型旁空白可点到底下窗口；穿透关：整窗可拖。
- **验收**：开关即时生效；穿透态下右键模型本体仍出菜单。

### W-M6-6 壳内 ASR 降级自检
- **改动点**：pet 页检测 `SpeechRecognition` 缺失（WKWebView/WebView2）→ 自动选 endpoint 引擎；均不可用时气泡给一次性指引（配端点或等 v1.x 本地识别）；自检结果上报设置分区。
- **测试**：unit——capabilities 组合矩阵下的引擎选择与指引文案。
- **验收**：壳内（无 Web Speech）已配端点：按住说话可用；未配：出指引不报错。

### W-M6-7 打包分发
- **改动点**：tauri bundle 配置（mac dmg + win msi；图标、签名占位）；`.github/workflows/shell-release.yml`（tag 触发双平台构建上传 Releases）；配置中心「悬浮与桌面」放下载链接与壳在线状态（壳心跳 `POST /friend/shell/heartbeat`）。
- **测试**：CI——release 工作流在 tag 上跑通产出双安装包。
- **验收**：从 Releases 下载 dmg 安装到干净 mac 可用（手册全流程）；配置中心显示「壳已连接」。

---

## M7 成长 + 工作陪伴

### W-M7-1 growth 纯函数移植
- **改动点**：旧仓 `ai/growth.rs` 的解析/排序/时间纯函数 → `dsh-friend-growth/src/pure.ts`（OutlineEvent/ParsedBeat/ReflectionResult 类型、节拍解析、按年龄排序、`compose_memory_content` 的全角年龄前缀规则、importance 缺省 0.7/反思下限 0.9）。
- **测试**：unit——**旧 Rust 单测逐条直译**（fixture 同源），含畸形 LLM 输出的解析容错。
- **验收**：直译用例 100% 通过；同一 fixture 在旧实现与新实现输出等价（对拍脚本）。

### W-M7-2 三阶段流水线
- **改动点**：`src/pipeline.ts`——outline → expand（批 4）→ reflect；用 `resolveModel('growth')`；草稿态落 `growth/<batch>/`（profile status `drafting`，不自动 commit）；进度经 SSE（复用 `asset-progress` 事件形）；可中断续跑（按批幂等）。
- **测试**：unit——mock LLM 三阶段编排、批次切分、中断续跑水位、失败批重试不重复。
- **验收**：int——默认模型对新角色全程 < 5 min 产出草稿；中途 kill 再启动从断点续跑（批号断言）。

### W-M7-3 产物提交
- **改动点**：`src/commit.ts`——草稿审阅通过后：episodes→`story.md`（编年、全角年龄前缀）、reflections→`beliefs.md`、人生小结→MEMORY.md「近期主题」节；story.md 纳入 retriever 检索面（W-M5-2 已含）；提交幂等（重复提交覆盖同 batch 产物）。
- **测试**：unit——三文件渲染快照、幂等覆盖、MEMORY 追加不破坏其他分节。
- **验收**：int——提交后问「你小时候的事」，回答引用 story.md 情节；beliefs 出现在系统提示词人格区。

### W-M7-4 成长 UI
- **改动点**：配置中心「成长」分区：生成/续写按钮、进度条、草稿节拍列表预览（可勾除个别节拍）、提交按钮、目标语言与模型 override。
- **测试**：unit——进度渲染、勾除后提交集合正确；e2e 冒烟开页。
- **验收**：全流程（生成→预览→勾除 1 条→提交）手册走通，被勾除节拍不出现在 story.md。

### W-M7-5 reactions 事件订阅与过滤
- **改动点**：`dsh-friend-reactions/src/observe.ts`——订阅全局 `session/event`；过滤：伴侣预设会话排除、静音名单排除、只取元数据（事件类型/时长/成败），**不读文件内容与用户文本**；归一化为内部事件（turn-start/tool-long/tool-error/turn-success/plan-approved）。
- **测试**：unit——事件流 fixture 断言过滤与归一化（含伴侣会话混流场景）；隐私断言：内部事件对象无 payload 字段。
- **验收**：int——伴侣会话说话不触发任何反应；编码会话触发（下一项验收）。

### W-M7-6 反应映射与节流
- **改动点**：`src/react.ts`——内置映射表（§5.8）→ stage 指令；节流：全局冷却 45 s、同类 5 min、免打扰时段（cron 表达式或时间段）、每会话静音；全部可配。
- **测试**：unit——fake timers 下节流矩阵（密集事件只放行首个、跨类不互斥、免打扰内全禁）。
- **验收**：int——连续 3 个 turn 完成只庆祝 1 次；免打扰时段内零反应。

### W-M7-7 台词三档
- **改动点**：`src/quips.ts`——档位：仅动作（默认）/ 动作+气泡（内置台词库分事件类别各 ≥ 8 条，随机不重复窗口 3）/ 动作+语音（台词走 TTS，复用队列）；台词库 i18n。
- **测试**：unit——档位分发、随机窗口不重复、TTS 档只入队一条。
- **验收**：三档各手册验证一次；台词档位切换即时生效。

---

## M8 配置中心与发布

### W-M8-1 设置父卡片
- **改动点**：`dsh-friend-settings/client/PluginCard.tsx`——注册 `settings.plugin.item`（order 100+）：总开关、悬浮层开关、音量/静音、当前角色下拉、分区快捷入口按钮；staged 表单（参照 dsh-remote-web-ui 样板）。
- **测试**：unit——staged 提交/放弃、开关联动（总开关灭时子项禁用）。
- **验收**：dsh 设置→插件配置出现卡片；总开关关→悬浮层与反应全部停用（int 断言无 SSE 指令流出）。

### W-M8-2 配置中心整页壳
- **改动点**：按 M0 探路结论：官方整页槽位 或 全屏覆盖层；左侧十分区导航（模型/人设/语音合成/语音输入/形象/记忆/成长/工作陪伴/悬浮与桌面/数据与关于）；路由状态可分享（hash）；关闭返回设置页。
- **测试**：unit——导航切换与懒加载；e2e——从卡片按钮进入、十分区各渲染一次无报错。
- **验收**：十分区全部可达；刷新后停留在原分区（hash 恢复）。

### W-M8-3 十分区表单接入
- **改动点**：把 M1–M7 各包的设置组件挂进对应分区；「模型」分区（继承状态展示 + chat/summarize/growth 三处 override + 连接测试按钮）为本项新建。
- **测试**：unit——模型分区表单与 resolveModel 联动；其余分区冒烟渲染。
- **验收**：每个分区改一项配置→立即生效（抽查 5 项：音色/快捷键/蒸馏时刻/反应档位/帧率）。

### W-M8-4 i18n
- **改动点**：`dsh-friend-shared/src/i18n/`——zh（默认）/en 资源；旧仓 zh.json 相关词条改写迁移；语言跟随 `friend.core.language`（default: 系统语言）。
- **测试**：unit——键完整性检查（zh/en 键集合相等，CI 断言）；缺键回退 zh。
- **验收**：切 en 后配置中心与卡片无中文残留（人工抽查 3 页）；键完整性 CI 绿。

### W-M8-5 数据与关于分区
- **改动点**：打开数据目录（host 调 `open`/`explorer`）、导出 zip（打包 `~/.dsh/friend/` 排除 cache/vendor）、导入旧版数据按钮（走 W-M5-8）、版本号与更新检查（GitHub Releases API）、许可与致谢（MIT 链 + Live2D 三件 NOTICE + 素材授权状态）。
- **测试**：unit——导出内容清单断言（含/不含目录正确）；更新检查对 mock API 的三态（最新/有新/失败）。
- **验收**：导出 zip 可在新机导入还原记忆与角色（手册）；致谢页列出全部 NOTICE。

### W-M8-6 合规文件
- **改动点**：根 `LICENSE`（MIT：保留 `Copyright (c) 2026 chyinan` + 追加本项目行）；README「Derived from Kokoro Engine」声明；`docs/assets-compliance.md`（Hiyori/Cubism/鲸鱼娘授权台账）；各包 LICENSE 字段核对；`THIRD-PARTY-NOTICES.md`（pixi-live2d-display 内嵌 Cubism Framework 声明等）。
- **测试**：CI——license-checker 扫描无未知许可依赖。
- **验收**：§11 表格逐行有对应落地物；npm 包 tarball 不含任何 Live2D 专有文件（CI 断言）。

### W-M8-7 文档与演示物料
- **改动点**：根 README（一行安装、30 秒 GIF：说话+口型、功能矩阵、与 dsh-pet 定位区隔、隐私说明：记忆明文本地）；`docs/dev-loop.md` 完善；GitHub topic `dsh-plugin`。
- **测试**：—。
- **验收**：让一位未参与者按 README 从零装到能语音对话 ≤ 10 min（手册计时）。

### W-M8-8 发布流水线与全流程实测
- **改动点**：changesets（11 包版本联动）；`release.yml`（npm publish + provenance）；壳 Releases（W-M6-7）；发布后在干净环境 `dsh plugin --profile web add github:<owner>/dsh-Friend` 全流程实测记录。
- **测试**：CI——release dry-run（`--no-git-tag` 到本地 registry/verdaccio）。
- **验收**：迁移计划 §13 DoD 清单 14 条逐条勾绿（本文件底部映射表复核）；`npm view` 可见 11 包同版本。
- **可发布性前置**（现已满足）：11 个包均有与根 `LICENSE` 一致的 `license` 字段、均不是 `private: true`、scope 包均声明 `publishConfig.access`。发布前用 `node scripts/release-scan.mjs --require-publishable` 做二值判定，不要等 `pnpm publish` 失败才发现。

---

## DoD 覆盖映射（复核用）

| 迁移计划 §13 DoD | 覆盖工作项 |
|---|---|
| 一条命令安装+设置卡片 | W-M0-3、W-M8-1、W-M8-8 |
| 零 key 对话+TTS+口型 | W-M1-6、W-M2-2、W-M4-8 |
| 断网 TTS 兜底 | W-M2-1、W-M2-4 |
| 按住说话/自动监听/打断 | W-M3-1…4 |
| 悬浮层完整交互 | W-M4-1、W-M4-4、W-M4-5 |
| 表情协议不泄漏 | W-M4-6、W-M4-7 |
| 记忆跨重启+检索+护栏 | W-M5-1…6 |
| 成长生成与引用 | W-M7-1…4 |
| 工作陪伴+节流 | W-M7-5…7 |
| 桌面壳全套 | W-M6-1…7 |
| 配置中心十分区即时生效 | W-M8-1…3 |
| importer | W-M5-8 |
| 合规文件 | W-M4-2、W-M8-6 |
| 双发布+CI/canary | W-M0-7、W-M8-8 |
