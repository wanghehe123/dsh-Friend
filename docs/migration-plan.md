# dsh-Friend 迁移计划

> Kokoro-Engine（Tauri + Rust + React）→ DeepSeek Harness（dsh）插件套件
>
> 版本：v1.0（2026-08-14）｜状态：**已评审**——13 条产品设想全部有结论，8 项开放决策已由项目所有者拍板，无待确定项。
>
> 本文是项目唯一权威蓝图。实现过程中的任何决策变更都应回写本文档。
>
> **配套文档**：执行清单见 `docs/work-breakdown.md`（M0–M8 全部 66 个工作项，每项 = 改动点+测试+验收标准，ID 形如 `W-M2-5`）；行为契约见 `openspec/specs/`（12 个能力域第一版 spec，`openspec validate --specs` 全绿）。分工：本文管「为什么与怎么设计」，work-breakdown 管「做什么与怎么验收」，openspec 管「系统必须表现出什么行为」；第一版 spec 之后的行为变更走 `changes/` 提案流程（`.agents/skills/openspec-*`）。

---

## 0. 前置与适用范围

- **前置调研**（前一会话产物，结论已吸收进本文）：
  - Kokoro→dsh 可行性分析：Rust 57,262 行中约 39% 由 dsh 平台直接承接（IPC 胶水、LLM 适配、MCP、MOD 沙箱），真正移植大头是 `ai/`（记忆/成长/自主性）与各语音 provider；前端 33,226 行 TS 大半可搬迁复用。
  - whale-girl / dsh-pet 差异化分析：sprite 桌宠是"工作台吉祥物"，dsh-Friend 是"Agent 本身的人格化"（提示词层人格 + 语音闭环 + 对话级记忆 + 模型驱动表演），生态位互补。
- **适用版本**：dsh developer preview；官方 NPM SDK `@deepseek-ai/*`（本文写作时 `^0.1.0-rc.6`），`cordis ^4.0.1`。dsh 明确声明会有破坏性变更，应对策略见 §10.2 与 §12。
- **上游与授权**：逻辑源自 [chyinan/Kokoro-Engine](https://github.com/chyinan/Kokoro-Engine)（MIT），本项目为衍生作品，合规义务见 §11。

---

## 1. 目标与定位

**一句话**：把 AI 伴侣「以 dsh 原生形态」重构为一组插件（bundle）+ 一个伴侣 Agent 预设 + 一个可选的桌面薄壳，让用户在已有 dsh 环境里**零配置**获得一个有脸、有声音、有记忆、会陪你写代码的伴侣。

**零配置承诺**（v1 验收的北极星，详见 §6 / §13）：

1. 一条命令安装（`dsh plugin --profile web add ...`），重启 `dsh web` 即生效；
2. 文本模型直接继承用户在 dsh 里配好的 DeepSeek，**不需要任何新的 API key**；
3. TTS 默认走免费 Edge TTS（浏览器 speechSynthesis 自动兜底），**不需要 key**；
4. 语音输入默认走浏览器 Web Speech API，**不需要 key、不需要下载模型**；
5. 形象默认内置免费占位 Live2D 模型（鲸鱼娘模型授权/委托完成后热替换）；
6. 记忆开箱即用（纯 Markdown，不需要 embedding 模型）。

**生态位**：dsh 生态已有 sprite 桌宠（dsh-web-ui 家族的 dsh-pet / 鲸鱼娘）。dsh-Friend 的差异化在于：人格进入提示词层、完整语音闭环、Live2D 连续参数动画、Markdown 长期记忆、成长（人生故事）系统。悬浮位置默认与 dsh-pet 错开，检测到共存时自动避让。

---

## 2. 决策记录

### 2.1 十三条产品设想的处置

| # | 原设想 | 处置 | 落点 |
|---|--------|------|------|
| 1 | 配置管理全部迁入 dsh 设置→插件栏目，点击进入配置页 | ✅ 采纳（混合形态） | §5.9：设置卡片（`settings.plugin.item` 槽）+ 独立全页配置中心 |
| 2 | 长期记忆去 embedding 化，OpenClaw 式 Markdown | ✅ 采纳（v1 仅 Markdown + 预留检索接口） | §5.2 |
| 3 | 零配置启动：内置免费 TTS/语音输入，文本模型继承 DeepSeek 配置，支持自定义模型 | ✅ 采纳 | §5.3 / §5.4 / §3.5 |
| 4 | 观察屏幕砍掉、保留接口 | ✅ 采纳 | §5.11（PerceptionProvider seam，无 UI 无工具） |
| 5 | 人物形象：可上传自定义 + 内置鲸鱼娘 Live2D | ✅ 采纳（v1 官方样例占位，鲸鱼娘另行委托） | §5.5 |
| 6 | 语音识别：按住说话快捷键 + 自动监听可选（按下/按住可配） | ✅ 采纳 | §5.4 |
| 7 | 绘图砍掉 | ✅ 砍（`imagegen/` 1,040 行 + 「背景」页的 AI 背景一并移除，主题交给 dsh 皮肤生态） | — |
| 8 | MCP 功能砍掉，只附带原本内置的几个 | ✅ 砍管理界面；随包附带 time | §5.12 |
| 9 | 模组砍掉 | ✅ 砍（dsh 插件体系就是 MOD） | — |
| 10 | Bot 接入砍掉 | ✅ 砍（`telegram/` `qqbot/` `bot_config` 全部不迁移） | — |
| 11 | 破限提示词砍掉 | ✅ 砍 | — |
| 12 | 桌面悬浮原样照搬 | ✅ 采纳（决策：桌面薄壳进 v1，见 2.2） | §5.10 |
| 13 | 前端 UI 摒弃旧风格，与 dsh 一致 | ✅ 采纳（官方 client SDK 组件 + dsh 设计语言，工程范式照 dsh-web-ui 家族） | §4 / §10 |

### 2.2 八项评审决策（2026-08-14 拍板）

| # | 议题 | 决策 |
|---|------|------|
| D1 | 记忆架构 | **v1 仅 Markdown**（MEMORY.md + 每日笔记 + 定时 LLM 归纳 + 文件工具检索），代码抽 `MemoryRetriever` 接口；embedding 检索日后作为独立可选插件发布，不做配置切换双轨 |
| D2 | 桌面悬浮形态 | **OS 级桌宠必须 v1 就有**：桌面薄壳（Tauri）随 v1 交付，同时保留页面内悬浮层；全局快捷键由薄壳提供 |
| D3 | TTS 默认 | **Edge TTS 默认**（免费微软神经音色），browser speechSynthesis 自动兜底，自定义 OpenAI 兼容端点作为进阶项 |
| D4 | 语音输入默认 | **Web Speech API 默认**（Chrome/Edge 零下载），本地 SenseVoice 作为可选安装（v1.x），自定义 OpenAI 兼容 ASR 端点保留 |
| D5 | 内置形象 | **免费官方样例模型占位**（Hiyori，随行 NOTICE），鲸鱼娘 Live2D 另行委托/授权，完成后热替换 |
| D6 | v1 范围 | 主线之外纳入：**表情/情感（简化版）**、**成长系统**、**工作陪伴反应**；「主动发言/闲置行为」排入 v1.x |
| D7 | 配置界面 | **混合**：设置页一张 dsh-Friend 卡片（开关+常用项）+ 独立全页配置中心承载复杂配置 |
| D8 | 附带 MCP | **仅 time**（时间/时区），其余交给 dsh 生态 |

---

## 3. 总体架构

### 3.1 运行拓扑

```
┌────────────────────────────────────────────────────────────────────┐
│  dsh host 进程（node）                                              │
│  ├─ dsh 内核：ctx.llm / ctx.tools / ctx.agents / ctx.sessions /     │
│  │            ctx.systemPrompt / settings / approval ...            │
│  └─ dsh-Friend host 半区插件：                                       │
│     persona · memory · tts · asr(代理) · stage(资产) · growth ·      │
│     reactions · settings · perception(空) · time 工具               │
│     └─ 注册 HTTP 路由 /friend/*（资产、TTS 音频、pet 页、SSE 事件）    │
└──────────────┬─────────────────────────────┬───────────────────────┘
               │ http://127.0.0.1:3080       │ http://127.0.0.1:3080/friend/pet
┌──────────────▼──────────────┐  ┌───────────▼──────────────────────┐
│ 浏览器：dsh Web GUI          │  │ friend-shell（Tauri 薄壳，可选）   │
│ ├─ dsh 官方界面（会话/设置）  │  │ 透明·置顶·无边框 OS 窗口           │
│ └─ dsh-Friend client 半区：  │  │ 加载独立 pet 页（同一 stage 代码）  │
│    悬浮形象层 · 设置卡片 ·    │  │ + 全局快捷键（显隐/按住说话）        │
│    配置中心页 · 语音输入 ·    │  │ + 托盘 · 开机自启                  │
│    TTS 播放与口型同步        │  │                                   │
└─────────────────────────────┘  └──────────────────────────────────┘
```

三个运行位共享同一套插件代码：桌面壳只是"第二块屏幕"，加载的 pet 页与页面内悬浮层复用同一 client 包。

### 3.2 dsh 机制映射表（能力 → 机制）

| dsh-Friend 能力 | dsh 机制 | 依据 |
|---|---|---|
| 伴侣人格进入系统提示词 | `ctx.systemPrompt.section()`（scope 限定在伴侣 preset） | 官方扩展手册 "System prompt configurability" |
| 伴侣形态（工具集+提示词组合） | Agent Preset（agent → preset → global 作用域） | 官方 preset 机制 |
| 记忆读写工具 | `ctx.tools.register()` / `defineTool` | 扩展手册 "Memory: section provider + tool" |
| 定时归纳（梦境整理） | cron 型插件：定时器触发，空闲 `followup()` / 忙时 `inject()`；归纳本身直接调 `ctx.llm` | 扩展手册 "Scheduled tasks (cron)" |
| 表情/动作工具 | `ctx.tools.register()`；执行结果经 `/friend/events` SSE 推给 client | 同上 + whale-girl 已验证的 client 自渲染模式 |
| 悬浮层/配置中心/设置卡片 | client 半区（`dsh.client` 声明 + `window.__ModuleLoader__`）+ `settings.plugin.item` 槽 + `ctx.settingsScope` | dsh-web-ui `docs/plugins.md`（20260811+ 能力） |
| 工作陪伴反应 | 监听 `session/event`（assistant chunk、turn/step 边界、工具活动），只观察不注入 | 扩展手册 "UI plugin" 模式 |
| 文本模型继承 | 直接用 `ctx.llm` 当前解析出的默认模型；按用途允许 override | dsh 模型适配器体系（`dsh-llm-deepseek`） |
| 配置存取 | host：`installSettingsSection`（`@deepseek-ai/dsh-settings`）；client：`ctx.settingsScope.bind({namespace})` | dsh-web-ui `docs/plugins.md` |
| 分发 | 官方 bundle 格式（`dsh.bundle` + `dsh.client`）+ `dsh plugin --profile web add github:...` | whale-girl 迁移后的官方答案 |

### 3.3 host ↔ client 通信约定

- **配置**：一律走 `settingsScope`（命名空间见 §5.9），host 用 `setSource`/`onChange` 即时生效，避免自造配置通道。
- **host → client 推送**（表情指令、反应指令、TTS 就绪通知）：host 注册 `GET /friend/events`（SSE）；client 半区建立单一 EventSource，按 `type` 分发（`expr`、`motion`、`cue`、`reaction`、`tts-ready`、`asset-progress`）。M0 验证 dsh 是否已提供等价的推送 seam，有则改用官方通道（收敛进 `dsh-compat`）。
- **client → host**：常规调用走 HTTP 路由（`POST /friend/tts/synthesize`、`POST /friend/asr/transcribe`、`POST /friend/models/upload` 等）；与会话相关的输入走 dsh 原生 `agent.followup()`。
- **音频**：TTS 合成产物由 host 缓存并以 `GET /friend/tts/audio/:id` 提供，client 用 AudioContext 播放并做口型分析。

### 3.4 数据布局

配置项存 dsh settings（命名空间隔离）；**大块数据全部是明文文件**，放统一数据根目录：

```
~/.dsh/friend/
├── characters/
│   └── <slug>/                    # 每角色一目录
│       ├── persona.json           # 角色卡（含称呼、回复风格、语言）
│       ├── MEMORY.md              # 精选长期记忆（会话启动注入）
│       ├── memory/
│       │   ├── 2026-08-14.md      # 每日笔记（追加式；启动读今昨两天）
│       │   └── imported/…         # 旧版数据导入产物（§7）
│       ├── story.md               # 成长系统产物：编年人生履历
│       └── beliefs.md             # 成长系统产物：核心信念（注入人格区）
├── user/USER.md                   # 用户画像（跨角色共享，主会话注入）
├── models/<name>/                 # 用户上传的 Live2D 模型
├── vendor/                        # 首启下载：Cubism Core、Hiyori 样例（§5.5/§11）
├── cache/tts/                     # TTS 音频缓存（LRU）
└── growth/…​                      # 成长流水线中间产物（草稿节拍）
```

好处：可 grep、可 git、可手改、备份 = 拷目录（旧「备份」页由此消失，只留"打开数据目录/导出压缩包"按钮）。

### 3.5 伴侣会话模型

- 安装后注册 Agent 预设 **`friend-companion`**（默认）：
  - 系统提示词：人格区（persona + beliefs）+ 记忆区（MEMORY.md + 今昨每日笔记）+ 行为守则区（表情标签协议、记忆记录守则、语言）；
  - 工具集（restrict）：`memory_append` / `memory_search` / `memory_get`、`set_expression` / `play_motion` / `play_cue`、`notify`、time 工具；**默认不带** bash/fs/web（她是伴侣不是码农）；
  - 变体预设 **`friend-companion-plus`**：在上者基础上放开 dsh 网页搜索与文件只读，供高级用户选择。
- **常驻会话**：悬浮层/桌面壳的快捷聊天绑定一个持久会话（首次创建，id 记入配置），输入经 `followup()` 送入；上下文长度交给 dsh 的 compaction。用户也可在 dsh 会话页手动用该预设开新会话，记忆层保证连续性。
- 模型：不做任何模型配置也能跑（继承 dsh 默认模型）；配置中心允许分别覆写「对话模型」与「归纳/成长模型」（可选低价模型）。

---

## 4. 仓库与包结构

pnpm monorepo，工程范式对齐 dsh-web-ui 家族（脚手架、`shared/tsdown.client.ts` 统一构建预设、聚合包脚本、`link-profile` 开发循环、vitest + `__ModuleLoader__` stub 测试基建）：

```
dsh-Friend/
├── docs/                     # 本计划、协议规格、素材合规记录
├── packages/
│   ├── dsh-friend-shared/    # ①
│   ├── dsh-friend-persona/   # ②
│   ├── dsh-friend-memory/    # ③
│   ├── dsh-friend-tts/       # ④
│   ├── dsh-friend-asr/       # ⑤
│   ├── dsh-friend-stage/     # ⑥
│   ├── dsh-friend-growth/    # ⑦
│   ├── dsh-friend-reactions/ # ⑧
│   ├── dsh-friend-settings/  # ⑨
│   ├── dsh-friend-perception/# ⑩
│   └── dsh-friend-all/       # ⑪ 聚合 bundle
├── apps/
│   └── friend-shell/         # ⑫ Tauri 桌面薄壳（不发 npm）
├── shared/                   # tsdown 构建预设、web 平台模块表（仿 dsh-web-ui）
└── scripts/                  # dsh-plugin-new、aggregate.mjs、link-profile.mjs、import-kokoro.mjs
```

| # | 包 | host 半区职责 | client 半区职责 |
|---|---|---|---|
| ① | `dsh-friend-shared` | `dsh-compat.ts`（对 dsh SDK 的**唯一**薄封装收口）、配置 schema 助手、`/friend/events` SSE 基建、i18n 资源 | UI 基元（跟随 dsh 设计语言）、EventSource 客户端、公共 hooks |
| ② | `dsh-friend-persona` | 角色卡存取、预设注册（companion / plus）、人格+守则 section | 人设配置页（角色卡增删改/导入导出/称呼/风格） |
| ③ | `dsh-friend-memory` | Markdown 存储、记忆工具、bootstrap section、会话自动小结、夜间归纳 job、`MemoryRetriever` 接口 | 记忆浏览器（读/改/搜/手动归纳按钮） |
| ④ | `dsh-friend-tts` | TTS Service seam、edge/openai-compat provider、队列+缓存、文本预处理、音频路由 | 播放器、口型数据泵、speechSynthesis 兜底、试听 UI |
| ⑤ | `dsh-friend-asr` | 自定义端点转写代理（key 保管在 host）、转写路由 | Web Speech 引擎、按住说话/切换/自动监听、页面内快捷键、打断 TTS |
| ⑥ | `dsh-friend-stage` | 模型资产管理（上传/解压/列表）、首启资产下载器、表情/动作/演出工具注册 | Live2D 渲染（pixi）、口型同步、标签解析、悬浮层组件、独立 pet 页 |
| ⑦ | `dsh-friend-growth` | 人生故事流水线（outline→expand→reflect）、产物写 story.md/beliefs.md | 成长页（生成/进度/预览/提交） |
| ⑧ | `dsh-friend-reactions` | 订阅非伴侣会话 `session/event` → 节流 → 反应指令 | （演出由 stage 执行，本包 client 仅配置表单） |
| ⑨ | `dsh-friend-settings` | 聚合各包 settings 命名空间注册 | dsh-Friend 父卡片（`settings.plugin.item`）+ 配置中心整页壳与路由 |
| ⑩ | `dsh-friend-perception` | `PerceptionProvider` seam + no-op 实现（无工具无 UI） | — |
| ⑪ | `dsh-friend-all` | 聚合 `cordis.patch.yml`（含 time MCP 接线）+ 依赖清单 | — |
| ⑫ | `friend-shell` | —（Tauri app：透明置顶窗、全局快捷键、托盘、自启、加载 /friend/pet） | — |

命名与发布：npm scope 用项目所有者账号（占位 `@wishp3/dsh-friend-*`，发布前定稿）；GitHub 仓库 `dsh-Friend`，加 `dsh-plugin` topic；版本从 `0.1.0` 起。

---

## 5. 模块详细设计

### 5.1 人设与预设（dsh-friend-persona）

**目标**：角色卡驱动的人格系统，伴侣预设一键可用。

**旧代码来源**：`src-tauri/src/ai/context.rs`、`prompts.rs`（提示词组装）；`src/lib/character-card-parser.ts`（SillyTavern 酒馆卡解析，**直接搬迁含测试**）；app data `active_character_id.json`、`user_profile.json`、`response_style.json`。

**设计**：

- 角色卡 = `characters/<slug>/persona.json`：`{ name, avatar?, personality, background, speakingStyle, language, nickname(称呼用户), greetings[], live2dModel?, voice?, tags[] }`；支持导入 SillyTavern PNG/JSON 卡（解析器已有）。
- 人格 section（order 靠前）：角色卡渲染 + `beliefs.md`（若有）+ 表情标签协议说明 + 记忆记录守则（"重要事实要调 memory_append"）。scope 仅伴侣预设，绝不污染用户的编码会话。
- 预设注册经 `dsh-compat` 封装（M0 确认官方 preset API 形态）。
- 多角色：允许多张卡，同一时刻一个「当前角色」；切换角色 = 切换数据目录 + 建议新开会话。

**配置**（namespace `friend.persona`）：当前角色、称呼、回复风格附加说明、默认语言。

**验收**：安装后新建 `friend-companion` 会话，模型以角色人格+称呼回复；酒馆卡导入成功率对齐旧版测试集。

### 5.2 长期记忆（dsh-friend-memory）——D1

**目标**：OpenClaw 式纯 Markdown 记忆，零 embedding、零向量库；文件即真相。

**旧代码来源**（弃用其存储、保留其经验）：`ai/memory.rs`（去重/衰减/护栏思想）、`memory_extractor.rs`（对话→事实抽取提示词）、`heartbeat.rs`（定时整理节奏）。旧 AGENTS.md 里的记忆护栏清单平移为本包 vitest 用例。

**存储规格**：

- `MEMORY.md`：精选长期层。固定分节：`## 关于用户` / `## 关系与约定` / `## 重要事实` / `## 近期主题`。目标体积 ≤ 8 KB（可配），超限由归纳任务压缩。全文注入伴侣会话系统提示词。
- `memory/YYYY-MM-DD.md`：每日追加层。条目格式 `- HH:mm [source] 内容`，source ∈ `chat`（会话小结）/ `note`（模型主动记）/ `import`（旧数据）/ `growth`。启动注入今+昨两天。
- `user/USER.md`：用户画像，跨角色共享，同样注入。

**写入路径（三条）**：

1. **模型主动**：`memory_append({ text, target: 'daily' | 'longterm' })` 工具；守则区鼓励"用户说『记住』就落盘"。
2. **会话自动小结**：监听伴侣会话 `turn/end`，空闲去抖（默认 10 min）后用「归纳模型」把增量对话压成 1-3 条事实写入当日笔记（可关）。
3. **夜间蒸馏**：默认每日 04:00（可配 + 手动按钮），LLM 读近 N 天笔记 → 去重、合并矛盾（新事实优先+标注日期）、按分节改写 `MEMORY.md`，原始笔记不动。提示词直接改写自 `memory_extractor.rs` 的中文提示词。

**检索**：`memory_search({ query })` = host 侧对 `MEMORY.md + memory/**/*.md + story.md` 跑 ripgrep（含中文，按行返回 path+行号+片段，上限 20 条）；`memory_get({ path, from, to })` 读片段。**代码上抽 `MemoryRetriever` 接口**（`search/get/bootstrap`），rg 实现为默认；未来 embedding 插件实现同一接口后可注册替换（对模型暴露的工具 schema 不变）。

**配置**（`friend.memory`）：总开关、自动小结开关+去抖分钟、蒸馏时刻、MEMORY.md 体积上限、归纳模型 override。

**验收**：关掉再打开 dsh，伴侣仍记得昨天约定；`memory_search` 能召回三天前的中文事实；蒸馏后 MEMORY.md 体积回到上限内且事实不丢（护栏用例）。

### 5.3 语音合成（dsh-friend-tts）——D3

**目标**：装完即说话，默认零 key；provider 可插拔。

**旧代码来源**：`tts/interface.rs`（trait → TS Service seam 直译）、`edge.rs`（Edge TTS 协议参考）、`queue.rs`（并发 3）、`cache.rs`（LRU 500 / TTL 1h）、`router.rs`、`voice_registry.rs`；前端 `src/lib/audio-player.ts`（**连测试搬迁**）、TTS 文本预处理（括号舞台指示剥离）逻辑与用例。

**设计**：

- Service seam：`FriendTtsProvider { id, listVoices(), synthesize(text, opts): Audio }`；host 内置 provider：
  - `edge`（默认）：微软 Edge 阅读语音 WSS 协议（优先采用现成 npm 实现并锁版本，接口非官方、见 §12 风险）；默认音色 `zh-CN-XiaoxiaoNeural`，语速/音调可调；
  - `openai-compat`：`POST {base}/audio/speech`（key 存 host settings，不下发浏览器）；
  - `browser`：特殊标记 provider，指示 client 用 speechSynthesis 本地合成（也是 edge 失败时的自动兜底）。
- 管线：assistant 文本流 → 按句切分（首句优先合成，降首响）→ 文本预处理（剥离 `（…）` `(…)` 舞台指示与表情标签，不朗读）→ 队列（并发 3）→ 缓存 → SSE `tts-ready` → client 顺序播放。
- 口型：client 用 AudioContext AnalyserNode 提取能量包络喂给 stage（browser 兜底 provider 无音频流，用 boundary 事件近似口型）。
- 打断：ASR 检测到用户开始说话 / 用户发新消息时停播并清队列（可配）。

**配置**（`friend.tts`）：自动朗读开关、provider 选择、各 provider 音色/语速/音调、兜底开关、并发、缓存开关、「舞台指示不朗读」开关；配置中心内置**试听**。

**验收**：全新环境不填任何 key，伴侣回复自动播放中文语音且口型同步；拔网线后回复仍有声（speechSynthesis 兜底）。

### 5.4 语音输入（dsh-friend-asr）——D4 + 设想 6

**目标**：按住说话 / 按键切换 / 自动监听三模式，默认零下载。

**旧代码来源**：`stt/interface.rs`（provider 抽象）、`stream.rs`/`transcript.rs`（增量转写状态机思想）、`src/lib/stt-vad-settings.ts`（**连测试搬迁**）；`mic.rs`（cpal 采集）不再需要——采集全部走浏览器/webview `getUserMedia`。

**设计**：

- 引擎抽象 `AsrEngine { start(mode), stop(), onPartial, onFinal }`，v1 两个实现：
  - `webspeech`（默认）：`SpeechRecognition`，`interimResults` 上屏、`continuous` 支撑自动监听；语言跟随角色/配置；
  - `endpoint`：`MediaRecorder` 采集 → `POST /friend/asr/transcribe`（host 转发 OpenAI 兼容 `/audio/transcriptions`，key 不出 host）。
  - v1.x：`sensevoice-local`（sherpa-onnx，host 侧推理 + 模型下载管理），同一接口挂入——**这也是桌面壳 webview 的最终答案**（见下）。
- **交互三模式**：
  1. 按住说话（push-to-talk）：按下开始、松开结束即送出；
  2. 按键切换（press-to-toggle）：按一下开始、再按一下结束；
  3. 自动监听（可选开启）：持续识别，末句静默超时（默认 1.2 s）自动发送；说话即打断 TTS。
- **快捷键**：页面内快捷键默认 `Alt+S`（可在配置中心重录，冲突检测）；模式（按住/切换）独立可配。OS 级全局快捷键由 friend-shell 提供（§5.10），动作语义与页面内一致。
- **已知边界（如实告知用户）**：Web Speech 仅 Chromium 系浏览器可用且需联网；**桌面壳的 WKWebView/WebView2 不保证有 Web Speech**——壳内语音输入自动降级为 `endpoint`（若已配）或提示启用 v1.x 本地 SenseVoice。配置中心显示当前环境的引擎可用性自检。
- 转写结果默认填入输入框（回车确认），可配"识别完自动发送"。

**配置**（`friend.asr`）：引擎、语言、快捷键+模式、自动监听开关+静默阈值、自动发送开关、打断 TTS 开关、自定义端点(base/key/model)。

**验收**：Chrome 里按住 `Alt+S` 说"今天天气不错"，松手后文本进输入框并发送；开启自动监听后连续对话无需碰键盘；说话时正在播放的 TTS 停止。

### 5.5 形象舞台（dsh-friend-stage）——D5 + 设想 5

**目标**：Live2D 形象渲染 + 悬浮层 + 模型管理；这是差异化的"脸"。

**旧代码来源**（搬迁为主）：`src/features/live2d/`（`Live2DController.ts`、`Live2DViewer.tsx`、`LipSyncProcessor.ts`、`DrawableHitTest.ts`、`cubism-core-loader.ts`）、`src/features/pet/`（`MessageBubble.tsx`、`PetContextMenu.tsx`、`usePetChat.ts` 改造为 dsh followup）；依赖 `pixi.js` + `pixi-live2d-display`。

**设计**：

- **渲染核**：pixi 应用封装为独立 React 组件（帧率上限可配，默认 60；页签隐藏时暂停 ticker）。
- **资产合规下载器**（host）：Cubism Core（`live2dcubismcore.min.js`）与占位模型 Hiyori **不入 npm 包、不入 git**——首次启用时从官方源下载到 `~/.dsh/friend/vendor/`，SSE 汇报进度；NOTICE/许可在「关于」板块常驻展示（§11）。鲸鱼娘模型到位后作为内置模型二号加入同一机制，配置切换即热替换。
- **模型管理**：上传 zip（含 `*.model3.json`）→ host 解压校验 → `models/<name>/`；每模型可带 `friend.map.json`（表情标签→expression/motion 映射 + 默认口型参数 id）；无映射文件时自动扫描模型自带 expressions/motions 生成默认映射。
- **悬浮层**（dsh 页面内）：右下角可拖拽/缩放，位置尺寸持久化；点击命中区触发 Tap 动作；右键菜单：静音、隐藏、切换监听、打开配置中心；检测到 dsh-pet（鲸鱼娘 sprite 桌宠）时默认换角落避让。含气泡：显示伴侣当前回复摘要与快捷输入框（绑定常驻会话）。
- **独立 pet 页**：host 注册 `GET /friend/pet` 返回极简 HTML（无 dsh GUI chrome），加载同一 client 渲染核 + 气泡 + 语音输入，供桌面壳与浏览器独立窗口使用；`?transparent=1` 时输出透明背景。
- **驱动接口**（供 tts/emotion/reactions 调用）：`stage.setExpression(name)`、`stage.playMotion(group,idx)`、`stage.playCue(name)`（复合演出）、`stage.lipSync(envelope)`。

**配置**（`friend.stage`）：当前模型、缩放/位置重置、帧率上限、口型开关、点击互动开关、悬浮层显示开关、避让开关。

**验收**：启用后悬浮层出现占位模型并眨眼待机；说话时口型同步；上传自定义模型后立即可切换；`/friend/pet?transparent=1` 在独立窗口透明渲染。

### 5.6 表情与情感协议（并入 persona/stage，无独立包）——D6·emotion

**目标**：让模型驱动表演；**砍掉旧的本地 ONNX 情绪分类器**（零配置不友好），改为模型自标注。

**协议**（写入人格区守则，client 解析）：

- 行内标签（流式友好、零工具开销）：`[expr:happy|sad|angry|shy|surprised|sleepy|neutral]`、`[motion:<组名>]`、`[cue:<演出名>]`；渲染与朗读前剥离；
- 显式工具（供复杂控制/工作陪伴复用）：`set_expression` / `play_motion` / `play_cue`（host 注册，经 SSE 下发 stage）。
- 标准表情词表固定 7 个（上表），经每模型的 `friend.map.json` 映射到具体资产；映射缺失时回退 neutral 并记日志。
- 情绪余韵：表情保持到下一标签或空闲 N 秒渐回 neutral。

**旧代码来源**：`src/lib` 的标签解析器与 `llm-thinking.ts`（思考块剥离，**连测试搬迁**）；`tts/emotion_tts.rs` 的"情绪→语气"映射简化为 edge 语速/音调微调（可关）。

**验收**：让伴侣"生气地说一句话"，表情切换 + 语气变化 + 文本/语音里不出现标签。

### 5.7 成长系统（dsh-friend-growth）——D6·growth

**目标**：移植「人生故事模拟」：为角色生成编年成长履历与核心信念，让人格有纵深。**不是 XP 等级系统**（与 whale-girl 的差异点，文档口径统一）。

**旧代码来源**：`ai/growth.rs`（outline→expand→reflect 流水线；解析/排序/时间为纯函数——**优先移植 + 单测直译**）、`ai/growth_store.rs`（存储改为文件）。

**设计**：

- 流水线（用「归纳/成长模型」，批量 4 节拍/次，与旧一致）：
  1. **outline**：按角色卡生成人生骨架事件（年龄+标题+梗概）；
  2. **expand**：逐批扩写成"节拍"（narrative + trait_effect + importance，默认 0.7）；
  3. **reflect**：生成核心信念（importance ≥ 0.9）+ 人生小结。
- 产物落盘：草稿在 `growth/`（状态 drafting，可预览/重跑），用户**提交**后：编年履历写 `characters/<slug>/story.md`（episodes 带全角年龄前缀，规则沿用 `compose_memory_content`）、信念写 `beliefs.md`（人格区注入）、人生小结进 `MEMORY.md` 的近期主题分节；story.md 纳入 `memory_search` 检索面。
- UI（配置中心·成长）：生成/续写/重新生成按钮 + 进度条（SSE `asset-progress` 复用）+ 草稿预览与提交。

**配置**（`friend.growth`）：开关、目标语言、成长模型 override。

**验收**：对新角色跑完整流水线 < 5 分钟（默认模型），提交后问伴侣"你小时候的事"，回答与 story.md 一致。

### 5.8 工作陪伴（dsh-friend-reactions）——D6·work-companion

**目标**：你在 dsh 里正常写代码，她在旁边看着并做出反应——吃下 whale-girl 验证过的需求，但用 Live2D+语音的代差实现。

**设计**：

- host 订阅全局 `session/event`，**过滤掉伴侣自己的会话**（按 preset 标识），只观察不注入、不改提示词、不读文件内容（隐私边界：仅事件元数据 + 事件文案）。
- 事件→反应映射（内置表，可扩展）：

| 触发 | 反应（stage 指令 + 可选台词） |
|---|---|
| turn 开始 / 模型思考 | `expr:neutral` + 托腮 motion |
| 长时间工具执行（>30 s） | 打瞌睡 idle |
| 工具报错 / turn 失败 | `expr:surprised` + 短安慰台词 |
| turn 成功结束 | 概率庆祝 `cue:celebrate` + 台词 |
| 计划获批准 | 点头 motion |

- 台词三档（配置）：**仅动作**（默认）/ 动作+气泡（内置台词库随机，零 LLM 成本）/ 动作+语音（台词走 TTS）。
- 节流：全局冷却默认 45 s、同类事件冷却 5 min、免打扰时段、单会话静音名单。

**配置**（`friend.reactions`）：开关、反应档位、冷却参数、免打扰时段。

**验收**：跑一个真实编码会话，任务完成时她庆祝一次；连续多次 turn 不刷屏（节流生效）；伴侣会话自身不触发反应。

### 5.9 配置体系（dsh-friend-settings）——D7 + 设想 1

**目标**：全部配置收进 dsh 设置→插件配置，复杂项进独立配置中心页——即截图中「Web UI 插件」同款形态的 dsh-Friend 版。

**设计**：

- **设置卡片**（`settings.plugin.item` 槽，order 100+）：总开关、悬浮层开关、音量/静音、当前角色下拉、五个"打开配置中心"分区快捷入口。样板照 `dsh-remote-web-ui` 的 staged 表单（`settings-form.ts` + `PluginSettingsCard.tsx`）。
- **配置中心**（独立整页）：M0 探明官方整页/路由槽位（`dsh-client-ui-slots`）；**保底方案**（无论如何可行）：卡片按钮打开 client 自渲染的全屏覆盖层（whale-girl 已验证 client 可自渲染任意 UI）。左侧分区导航：`模型 / 人设 / 语音合成 / 语音输入 / 形象 / 记忆 / 成长 / 工作陪伴 / 悬浮与桌面 / 数据与关于`。
- **命名空间**：`friend.core` / `friend.persona` / `friend.memory` / `friend.tts` / `friend.asr` / `friend.stage` / `friend.growth` / `friend.reactions` / `friend.pet`；host 侧统一由本包代各包调用 `installSettingsSection` 注册，client 侧 `settingsScope.bind` 读写；各分区配置键已在各模块节列出。
- **「数据与关于」分区**：打开数据目录、导出压缩包、旧版数据导入（§7）、版本与更新检查、许可与致谢（MIT 链 + Live2D NOTICE + 素材授权）。

**验收**：设置→插件配置出现 dsh-Friend 卡片；全部配置改动即时生效无需重启（`onChange` 通路）；配置中心十个分区可用。

### 5.10 桌面薄壳（apps/friend-shell）——D2 + 设想 12

**目标**：v1 交付 OS 级桌宠：透明、置顶、可拖拽缩放、全局快捷键——「原样照搬」旧 PetWindow 的体验，但实现瘦成一个壳。

**旧代码来源**：`src/windows/PetWindow.tsx`（拖拽/八向缩放/交互逻辑并入 pet 页）、`src-tauri/src/commands/pet.rs`（窗口配置持久化、全局快捷键注册——Tauri 侧直译）、`BubbleWindow` 融合进 pet 页不再单开窗。

**设计**：

- Tauri 2 极简 app（目标 < 1k 行）：单窗口 `transparent + always_on_top + decorations:false + skipTaskbar(可配)`，加载 `http://127.0.0.1:3080/friend/pet?transparent=1`；窗口位置/尺寸持久化（沿用 `pet_config.json` 字段语义：position/size/scale/fps）。
- **连接引导**：启动探测 dsh（默认 `127.0.0.1:3080`，可配）；不可达时显示引导页（一键复制 `npx @deepseek-ai/dsh web` / 可选"由壳代启动 dsh"开关，默认关）。
- **全局快捷键**（`tauri-plugin-global-shortcut`，支持按下/释放态，正是按住说话所需）：显隐 `CmdOrCtrl+Shift+Space`（沿旧默认）、按住说话 `CmdOrCtrl+Shift+M`（按下开始/松开结束；切换模式亦可配）。壳内语音输入引擎按 §5.4 自检降级。
- **托盘**：显示/隐藏、静音、打开配置中心（默认浏览器打开 dsh 设置）、退出；开机自启可选（`tauri-plugin-autostart`）。
- 点击穿透（非交互区 ignore cursor events）可选开关，沿旧行为。
- **分发**：GitHub Releases（macOS dmg + Windows msi 为 v1 目标，Linux 尽力而为）；壳不发 npm。配置中心「悬浮与桌面」分区提供下载链接与状态检测（壳在线时显示"已连接"）。

**配置**（`friend.pet`）：页面内悬浮开关（与壳互斥提示）、壳连接地址、全局快捷键两条、点击穿透、自启、置顶。

**验收**：双击启动壳 → 桌面出现置顶透明伴侣；全局按住说话在任意前台应用下可用；重启后位置尺寸复原；关壳不影响网页端。

### 5.11 视觉接口预留（dsh-friend-perception）——设想 4

`FriendPerception { capabilities(): { screen: boolean }, capture(opts): Promise<Frame | null> }`——注册 no-op 实现（capabilities 全 false）。**不注册任何工具、不出现任何 UI**，仅在代码层与文档层保留 seam；未来 DeepSeek 多模态可用时，出「屏幕感知 provider」独立插件实现同一接口。

### 5.12 附带 MCP：time——D8 + 设想 8

聚合包 `cordis.patch.yml` 附带官方"每 server 一插件"模式的 time 服务器接线（M0 确认官方 MCP 插件包名与配置格式；标准 `mcp-server-time` 经 uvx/npx 拉起）。若运行时依赖（uvx）在目标环境不可保证，回退方案：在 `dsh-friend-shared` 用原生 `defineTool` 实现 `get_current_time` / `convert_time`（零外部依赖，工具面等价）。MCP 管理 UI 一律不做——那是 dsh 本体的职责。

---

## 6. 零配置启动路径（用户视角）

```bash
# 前提：已在用 dsh（哪怕只配过 DeepSeek API key）
dsh plugin --profile web add github:<owner>/dsh-Friend   # ①一条命令
# 重启 dsh web → ②设置→插件配置出现「dsh-Friend」卡片 → 打开总开关
# ③首启向导（悬浮层气泡）：下载形象资产(进度条) → 选择称呼 → 麦克风授权(可跳过)
# ④开箱状态：DeepSeek 继承模型✓ EdgeTTS 语音✓ WebSpeech 语音输入✓ Markdown 记忆✓
# ⑤可选进阶：配置中心换模型/换音色/传自己的 Live2D/装桌面壳(下载 dmg/msi)
```

全程需要用户提供的信息：**0 个 API key、0 次模型下载确认（除形象资产 ~5 MB）**。

## 7. 旧数据迁移（scripts/import-kokoro.mjs）

一次性 CLI（也在配置中心「数据与关于」提供按钮）：`node scripts/import-kokoro.mjs --from "~/Library/Application Support/com.chyin.kokoro"`。

| 旧数据 | 位置 | 迁移动作 |
|---|---|---|
| 记忆 | `kokoro.db` memories 表 | better-sqlite3 只读打开 → 按 `created_at` 分组写 `memory/imported/YYYY-MM-DD.md`（带 `[import]` 源标）；importance ≥ 0.9 的条目额外汇总为「导入精选」分节追加进 `MEMORY.md` 供用户复核 |
| 角色卡 | db + `active_character_id.json` | 导出为 `characters/<slug>/persona.json` |
| 成长节拍 | db growth 相关表 | 已提交节拍重组为 `story.md` / `beliefs.md`；草稿丢弃 |
| 用户画像/回复风格 | `user_profile.json`、`response_style.json` | 合入 `USER.md` 与 persona 配置 |
| Live2D 自定义模型 | app data `live2d_models/` | 拷贝到 `~/.dsh/friend/models/` |
| 桌宠窗口参数 | `pet_config.json` | 映射进 `friend.pet` 配置 |
| LLM/TTS/STT 配置 | `llm_config.json` 等 | 生成一份「建议配置」报告供参考，不自动写入（新默认是继承 dsh，多数不再需要） |
| 聊天历史 | db conversations | **不迁移**（记忆已承载精华；如有强需求 v1.x 出只读导出器） |

实现约束：**只读**打开旧库；schema 以旧仓 `ai/database_migrations.rs` + sqlx migrations 为准在实现期核对。

## 8. 旧设置页 → 新落位映射

| 旧标签页（18） | 去向 |
|---|---|
| 背景 | 砍（AI 背景随绘图移除；主题交给 dsh 皮肤生态，后续可出配套皮肤） |
| 模型 / API | 配置中心·模型（继承 dsh 为默认；自定义 OpenAI 兼容端点；对话/归纳模型分别 override；上下文策略交给 dsh compaction，不再自做） |
| 绘图 | 砍 |
| 人设 | 配置中心·人设 |
| 成长 | 配置中心·成长 |
| 语音合成 | 配置中心·语音合成 |
| 语音识别 | 配置中心·语音输入（新增快捷键/三模式） |
| 记忆 | 配置中心·记忆（Markdown 浏览器替代旧参数堆） |
| 视觉 | 砍（seam 保留，无 UI） |
| 模组 | 砍（dsh 插件体系替代） |
| MCP | 砍管理 UI（随包附带 time） |
| Bot / Telegram | 砍 |
| 破限提示词 | 砍 |
| 备份 | 简化进 数据与关于（明文文件哲学） |
| 桌面悬浮 | 配置中心·悬浮与桌面 + friend-shell |
| 关于 | 数据与关于 |

情绪系统（旧 API 页内嵌的 ONNX 分类器）→ 由 §5.6 标签协议替代；系统 LLM（意图解析）→ 由归纳/成长模型 override 承接。

## 9. 里程碑计划

> 估时按业余时间（每周 10-15 h）粗估；每个里程碑以「可演示」收口，结束时跑一遍冒烟脚本并回写本文档。

| 里程碑 | 内容 | 关键任务 | 验收（可演示） | 估时 |
|---|---|---|---|---|
| **M0 骨架与探路** | monorepo + 开发循环 + 不确定性收敛 | 脚手架（仿 dsh-web-ui：scripts/shared/aggregate）；空插件挂载成功；`link-profile` 循环跑通；**探路清单**：官方 preset API 形态、整页/路由槽位、host 路由注册 API、SSE 或官方推送 seam、官方 MCP 插件包名；产出 `dsh-compat.ts` 首版 | `dsh web` 启动后日志可见全部空插件挂载；设置页出现空卡片 | 3-5 d |
| **M1 伴侣会话** | persona + 预设 | 角色卡存取/解析搬迁；人格 section；companion/plus 预设；继承模型验证 | 用预设开会话，人格化中文对话成立 | 4-6 d |
| **M2 语音输出** | tts | seam + edge/openai-compat/browser 兜底；队列缓存；文本预处理搬迁；试听 UI | 零 key 自动朗读，首响 < 2 s（缓存命中 < 0.5 s） | 4-6 d |
| **M3 语音输入** | asr | webspeech 引擎；三模式 + 页面内快捷键；打断 TTS；endpoint 引擎 | 按住 Alt+S 说话成文并发送；自动监听连续对话 | 3-5 d |
| **M4 形象舞台** | stage + 表情协议 | live2d 五件套搬迁；资产下载器；悬浮层 + 气泡快捷聊天；标签解析 + 三工具；口型对接 M2 | 悬浮层角色说话带口型与表情 | 5-8 d |
| **M5 记忆** | memory | 存储/工具/section；自动小结；夜间蒸馏；记忆浏览器；importer | 跨重启记忆连续；旧库导入成功 | 5-8 d |
| **M6 桌面薄壳** | friend-shell + /friend/pet | pet 页（透明模式）；Tauri 壳（窗口/托盘/自启/引导）；全局快捷键（含按住说话）；壳内 ASR 降级自检 | OS 桌宠常驻，任意应用前台下全局按住说话 | 5-8 d |
| **M7 成长 + 工作陪伴** | growth + reactions | 流水线移植（纯函数单测直译）+ 成长页；事件→反应 + 节流 + 三档台词 | 新角色生成人生故事并被问答引用；编码会话完成时她庆祝 | 4-6 d |
| **M8 配置中心与发布** | settings 整合 + 打磨 | 配置中心十分区成形；i18n（zh/en）；README/文档/演示物料（与 dsh-pet 同屏对比）；LICENSE/NOTICE 齐备；npm 发布 + `dsh plugin add` 全流程实测；壳出 dmg/msi | §13 DoD 全绿，对外可安装 | 4-6 d |

**合计约 37-58 天业余投入（6-9 周）**。依赖关系：M2/M3 可并行；M4 依赖 M2 的音频流；M6 依赖 M4 的 pet 页；M7 依赖 M5（story 入检索面）。

## 10. 工程规范

### 10.1 构建 / 测试 / CI

- TS 全仓；构建 tsdown（共享预设 `shared/tsdown.client.ts`，禁止包内复制）；client 半区经 `dsh.client` + `__ModuleLoader__` 加载，类型只来自官方 NPM SDK（**禁止**指向任何 dsh 源码 checkout——dsh-web-ui 的血泪规范照单全收）。
- vitest：`server.deps.inline: [/@deepseek-ai\//]`；client 半区用 `__ModuleLoader__` stub；**搬迁旧测试**：`audio-player.test.ts`、`llm-thinking.test.ts`、`stt-vad-settings.test.ts`、TTS 文本预处理用例、酒馆卡解析用例、growth 纯函数用例、记忆护栏清单（旧 AGENTS.md → vitest）。
- CI（GitHub Actions）：`pnpm install && pnpm -r build && pnpm -r test && node scripts/aggregate.mjs --check`；**每周定时 canary job** 用 `@deepseek-ai/*@latest` 重装构建，提前暴露 dsh 破坏性变更。
- 冒烟脚本：启动 dsh（linked bundle）→ 断言插件挂载日志 + `/friend/pet` 200 + 设置卡片存在（playwright，本地/nightly 跑）。

### 10.2 dsh 版本策略

- SDK 依赖**精确锁版**（renovate/PR 升级，禁 `^` 漂移上线）；
- 所有 dsh API 触点收敛进 `dsh-friend-shared/src/dsh-compat.ts`（preset 注册、section、tools、路由、推送、settings 六类），破坏性变更只修一处；
- M0 探路清单里的每个"官方形态未定"项都在 compat 层留 fallback 路径（已在 §3.3/§5.9/§5.12 标注）。

### 10.3 发布

npm：`@<scope>/dsh-friend-*` 十一连发（changesets 管版本）；聚合包 `dsh-friend-all` 是用户唯一入口。GitHub Releases 发壳安装包。README 提供一行安装 + 30 秒 GIF（角色说话+口型）+ 与 dsh-pet 的定位区隔说明。

## 11. 版权与合规

| 事项 | 义务 / 动作 |
|---|---|
| 上游 Kokoro-Engine（MIT, © 2026 chyinan） | LICENSE 保留原版权行 + 追加本项目行；README 注明 "derived from Kokoro Engine"；TS 重写仍属衍生作品，义务不变 |
| Live2D Cubism Core | 专有软件，**不得**随 MIT 包分发——首启从官方源下载（§5.5），保留 Live2D 专有许可声明；关注企业规模披露门槛条款 |
| pixi-live2d-display | MIT，但内嵌 Cubism Web Framework（Live2D Open Software License）——声明随「关于」展示 |
| Hiyori 占位模型 | Live2D Free Material License：NOTICE.md 随行（下载器一并取回），不得修改角色设计；同样不入包 |
| 鲸鱼娘 Live2D（待制作） | 委托前取得形象原作者（表情包作者 ZipZipPipe 一系）改作授权书面记录；避开 DeepSeek 商标元素的官方观感（命名不用 "DeepSeek 官方"字样）；授权记录存 `docs/assets-compliance.md` |
| 台词库 / 提示词 | 自撰或改写自旧仓（MIT 覆盖） |
| 用户隐私 | 记忆为明文本地文件——README 与配置中心明示；工作陪伴仅读事件元数据，边界写进文档 |

## 12. 风险与对策

| 风险 | 概率/影响 | 对策 |
|---|---|---|
| dsh developer preview 破坏性变更 | 高/高 | §10.2：锁版 + compat 收口 + 每周 canary；发布物注明适配的 dsh 版本区间 |
| Edge TTS 非官方接口失效 | 中/中 | provider 抽象 + speechSynthesis 自动兜底 + openai-compat 出口；接口变动只影响一个 provider 文件 |
| Web Speech 在壳 webview 不可用 | 高（壳内）/中 | §5.4 已内建降级链（endpoint → v1.x 本地 SenseVoice）；配置中心引擎自检明示 |
| 整页配置槽位官方未开放 | 中/低 | 保底全屏覆盖层方案已定（whale-girl 验证过 client 自渲染），M0 只是择优 |
| 悬浮层与 dsh-pet 位置/生态位冲突 | 低/低 | 默认避让 + 文档口径（人格化 Agent vs 工作台吉祥物）；成长系统口径统一为"人生故事"避免与 XP 混淆 |
| Live2D 页签后台节流掉帧 | 中/低 | ticker 随 `visibilitychange` 暂停；壳窗口不受影响 |
| 记忆文件无限膨胀 | 中/低 | MEMORY.md 体积上限 + 蒸馏压缩；每日笔记按月归档目录 |
| 归纳任务把记忆改坏 | 低/高 | 蒸馏前自动备份上一版 MEMORY.md（保留 7 份滚动）；护栏用例守住"事实不丢" |
| 鲸鱼娘授权/制作周期不可控 | 中/低 | D5 已解耦：占位模型上线不阻塞，热替换机制就绪 |

## 13. v1 验收清单（DoD）

- [ ] 一条 `dsh plugin add` 命令 + 重启后，设置→插件配置出现 dsh-Friend 卡片，总开关可用
- [ ] 不配置任何新 key：伴侣预设会话可对话（继承 DeepSeek）、回复自动中文语音（Edge TTS）、口型同步
- [ ] 断网兜底：TTS 自动降级 speechSynthesis 不静音
- [ ] Chrome 下按住 `Alt+S` 说话→成文→发送；自动监听模式连续对话；说话打断 TTS
- [ ] 悬浮层：占位 Live2D 待机（眨眼/呼吸）、拖拽缩放持久化、右键菜单、气泡快捷聊天
- [ ] 表情协议：`[expr:*]` 驱动表情且不见于文本/语音；`set_expression` 工具可用
- [ ] 记忆：跨重启记得昨日约定；`memory_search` 中文召回；夜间蒸馏后 MEMORY.md ≤ 上限且护栏用例全绿
- [ ] 成长：生成→提交→问答引用人生履历
- [ ] 工作陪伴：真实编码会话完成时庆祝，节流生效，伴侣会话不自反应
- [ ] 桌面壳：dmg/msi 安装后 OS 置顶透明桌宠、全局显隐与全局按住说话、断连引导页
- [ ] 配置中心十分区全部可用，改动即时生效
- [ ] importer 迁移本机旧数据成功（记忆/角色/成长/模型）
- [ ] LICENSE/NOTICE/致谢齐备；README 一行安装 + 演示 GIF；npm + GitHub Releases 双发布
- [ ] 全部搬迁测试 + 新增护栏测试通过；CI 绿；canary 工作流就位

## 14. v1 之后

- **v1.x**：主动发言/闲置行为（D6 排期项：cron + 空闲检测 + `followup(source: cron)`）、本地 SenseVoice ASR（sherpa-onnx + 模型下载管理，补齐壳内离线语音）、唤醒词、鲸鱼娘 Live2D 热替换上线、记忆只读导出器、Linux 壳。
- **v2**：embedding 检索插件（实现 `MemoryRetriever`，独立包可选装）、屏幕感知 provider（DeepSeek 多模态就绪后实现 `FriendPerception`）、配套 dsh 皮肤、角色内容生态（Live2D 模型 + 人设卡 + 语音预设的贡献规范）、LLM 生成式工作陪伴台词。
