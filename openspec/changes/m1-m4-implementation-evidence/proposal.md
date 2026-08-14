# 用 M1–M4 实现证据校正 spec 与验收

## Why

M0 校正了 SDK 探路阶段的五处猜测；M1–M4 落地后又积累了一批**已证实**的契约漂移：工具 DSL、发布物扫描、启动日志、rc.6 无法进程外枚举预设、Cordis `inject`、shared 三出口、TTS/ASR 细节、舞台标签策略、WBS 路径。这些条目已经写进代码与单测，但主 spec / WBS / `docs/dev-loop.md` 仍是实现前的表述，会让后续里程碑按错的验收去测、按错的 API 去写。

## What Changes

十条按证据回写（实现侧已落地，本 change **只改契约与实现指引文档**，不改业务代码）：

1. **A. 工具 schema 不是 zod**。`defineTool({ parameters })` 是 `ParameterSchemaSpec` 属性表（每项 `{ type, enum?, required?, description? }`），编译成 JSON Schema；`output.schema` + `output.render` 必填。schemastery 只给 settings 用。
2. **B. 发布物合规扫描**。禁止按 tarball 全文 `rg live2dcubismcore`（`lib/pet.iife.js` 合法引用全局名 `Live2DCubismCore`）。改为按文件扫描：不得存在 `.moc3` / `.model3.json` / `live2dcubismcore.min.js` 等专有文件。
3. **C. 挂载与预设就绪标记**。冒烟依赖 `dsh-friend:plugin-mount <包名>` 与 `dsh-friend:preset-ready <预设 id>`；替换 `docs/dev-loop.md` 里旧的 `[@wish233/dsh-friend-shared] apply()` 说法。
4. **D. rc.6 无法进程外枚举预设的工具/提示词**。W-M1-3 / W-M1-4 / W-M4-7 中依赖 inspect 的验收改写成「真实伴侣会话行为 + mock 组装管线单测」，并标注等官方查询能力后升级。**不删**这些验收意图。
5. **E. Cordis `inject` 是硬性要求**。读 `ctx.<service>` 前必须模块级 `export const inject = [...]`，否则代理在读属性（含 `=== undefined`）时抛错并拖垮插件树。
6. **F. shared 三个出口 + 包边界**。`.` / `./universal` / `./client` 用途不可混；跨包禁止相对 import，必须走包名 subpath。
7. **G. 语音输出契约**。缓存键扩字段、三级降级、browser-fallback 指令形状、`friend-tts` kebab 命名空间、synthesize 不得带 `apiKey`、两套 `stopAll` 需门面、Edge 协议依赖锁版本。
8. **H. 语音输入契约**。快捷键表「官方为准、缺省用内置」、打断归属 W-M3-4、Web Speech 只信 Chromium。
9. **I. 舞台标签三类策略**。词表内应用并剥离；形态合法但词不在表内仍剥离不应用；形态非法透传；未闭合超过 48 字符当正文吐出。
10. **J. WBS 路径**。W-M4-6/7 改为 `src/tag-parser.ts` / `src/tools.ts`。

另：本轮同步改 `docs/dev-loop.md`（C）与 `docs/work-breakdown.md`（A/B/J 与 D 的验收改写）。`docs/m0-findings.md` 按本 change 边界**不改**；E 与 A 的 SDK 细节写入本 change 的 design，归档后由后续工作项补进 findings。

## 需人工确认的决策

下列条目已按**当前实现**写入本 change 的 delta spec，作为提案默认值。它们具有产品决策性质，**尚未拍板**。负责人可整节批复「维持实现 / 改选 / 再议」。否决后另开 change 回滚对应 SHALL，不要在本文件里假装已批准。

### D1. rc.6 无法进程外 inspect 时，隔离验收怎么写

**背景**：`@deepseek-ai/dsh-agent-presets` 只有 `list/resolve/read/standingKeyFor/serviceFor`；`dsh-tools` 的 `get`/`schemas` 需要进程内 `ScopeKey`；`dsh-system-prompt` 只有 `assemble()`；`dsh` CLI 无 inspect；`dsh-host-webserver` 无 inspect 路由。常驻挂载是**第一次有会话使用该预设时**才 `ensureStanding`，`dsh web` 启动并不注册预设内工具。因此「读编码会话提示词 / 读 companion 会话 tool schema 数量」在进程外**当前做不到**。

| 选项 | 做法 | 利 | 弊 |
|---|---|---|---|
| **D-A（提案默认，已写入 spec/WBS）** | 保留原验收意图；拆成 (1) mock 组装管线 / 白名单集合单测 (2) 真实伴侣会话里触发一次可见行为（人格注入、工具调用）(3) 显式 **manual** 抽查编码会话不被污染 (4) 注明等官方查询 API 后升级为自动断言 | 现在就能二值判定；不丢掉隔离目标 | 编码会话零污染仍依赖人工或 mock，不是 live inspect |
| **D-B** | 这些 int 验收整项延期，直到官方提供 HTTP/CLI inspect | 不把「测不到」写成「已测」 | M1/M4 收口被上游阻塞 |
| **D-C** | 自己做 inspect 旁路（例如挂调试路由 dump `assemble()` / `tools.schemas`） | 可自动断言 live 状态 | 把非产品 API 做成契约，升级易碎，且可能泄漏内部 scope |

请选 D-A / D-B / D-C。默认按 D-A 落笔。

### H3. Safari 上的 Web Speech

**背景**：非 Chromium 的 Safari 即便存在 `webkitSpeechRecognition`，产品实现仍报 `available=false`（`packages/dsh-friend-asr/src/engines/webspeech.ts` 的 `isNonChromiumSafari`）。W-M3-1 验收已写「Safari/壳内如实返回不可用」，但主 spec 只写「无 SpeechRecognition 的 WebView」，没有把「有前缀 API 也不信 Safari」写成产品规则。

| 选项 | 做法 | 利 | 弊 |
|---|---|---|---|
| **H-A（提案默认，已写入 spec）** | Web Speech **只信 Chromium**（Chrome / Chromium / CriOS / Edg）。Safari 走不可用 + 指引改用 endpoint | 避免 WebKit 识别质量/权限坑；与壳内 WebView 降级一致 | Safari 桌面用户必须配自定义 ASR 才有语音输入 |
| **H-B** | 检测到 `webkitSpeechRecognition` 即尝试启用，失败再降级 | Safari 用户可能零配置能说 | 质量与稳定性未验证；「可用」会在设置页绿，体验可能差 |
| **H-C** | Safari 显示「实验性可用」开关，默认关 | 给高级用户出口 | 设置面变复杂；仍要维护两条质量预期 |

请选 H-A / H-B / H-C。默认按 H-A 落笔。

### I1. 形态合法但词不在表内的舞台标签

**背景**：主 spec 只写「非法标签按原文透传」。实现把标签分成三类：词表内 → 剥离并应用；`[expr:excited]` 这类**形态合法、词不在表** → **仍剥离、不应用**；`[foo:bar]` / 无冒号 / 含空格 → 原文透传。理由：协议标签不该漏给用户；`array[0]` 这类正文不该被吃掉。

| 选项 | 做法 | 利 | 弊 |
|---|---|---|---|
| **I-A（提案默认，已写入 spec）** | 形态合法一律从展示与 TTS 剥离；未知词 `applied: false` | 零协议泄漏；未知词不会误驱动舞台 | 模型胡写的 `[expr:excited]` 用户完全看不见，调试稍难 |
| **I-B** | 未知词当非法，原文透传 | 用户能看见模型写了什么 | 协议形标签泄漏到气泡/朗读 |
| **I-C** | 未知词剥离，但 UI 给一条非阻塞「忽略未知表情」提示 | 可观测 | 气泡噪音；要定义提示是否进 TTS（默认不应进） |

请选 I-A / I-B / I-C。默认按 I-A 落笔。未闭合标签超过 48 字符吐出正文，视为 I-A 的配套防吞字规则，一并通过或一并反对。

### G5. TTS API key 若被同步到 client

**已确定、不征求意见**（硬约束，实现已做）：`FriendTtsSynthesizeOpts` **不得**携带 `apiKey`；key 只从 host settings 闭包读取；client 快照经 `sanitizeTtsSettingsForClient` 丢掉密文字段，只留 `hasApiKey` 之类布尔。

**待定风险**：若 dsh 把整个 `friend-tts` namespace 同步给 client，`settingsScope.base` / `user` 仍可能是**未 decode 的原始文档**（含 `openaiApiKey`）。当前实现赌「client 只读 decode 后的 `value`」。

| 选项 | 做法 | 利 | 弊 |
|---|---|---|---|
| **G-A（提案默认，已写入 spec 的「client 只读 decode 后的 value」SHALL）** | 契约规定 client 代码路径只允许读 decode 后的 `value`；单测守卫快照无 key。若将来证实 dsh 会下发 raw `base/user`，再开 change 升级 | 不增加设置面；与现实现一致 | 若上游同步 raw 文档，存在泄漏窗口，要靠审查/单测补 |
| **G-B** | 密文字段放到独立 host-only namespace（例如 `friend-tts-secrets`），`friend-tts` 对 client 完全无 key 字段 | 即使整包同步也不含 key | 两个 namespace、迁移与备份变复杂；要确认 rc.6 能否声明「不同步」的空间 |
| **G-C** | 继续放在 `friend-tts`，但 host 写入时即加密/占位，decode 只在 host 合成路径 | 单空间 | 要自建加密与轮转；client 仍可能看到密文或占位符 |

请选 G-A / G-B / G-C。默认按 G-A 落笔。**无论选哪项，synthesize opts 带 key 都禁止。**

## Capabilities

### New Capabilities

- （无。不新增能力域。）

### Modified Capabilities

- `persona`：人格分区与预设白名单的**可执行**验收；`inject`；`dsh-friend:preset-ready` 标记。
- `voice-output`：缓存键、三级降级、fallback 指令形状、`friend-tts` 命名空间、key 不进 opts、打断门面、协议依赖锁版本、tts 的 `inject`。
- `voice-input`：快捷键表来源、barge-in 只到回调（真正 `stopAll` 属 W-M3-4）、Web Speech 只信 Chromium。
- `stage`：表演工具 `ParameterSchemaSpec`（非 zod）；合规扫描按文件；标签三类策略；stage 的 `inject`。
- `distribution`：启动可观测标记、Cordis `inject` 总则、shared 三出口与包边界、发布物按文件扫描。

## Non-goals

- 不改 `packages/**`、`scripts/`、`shared/` 任何业务或构建代码。
- 不修改 `openspec/specs/**` 主 spec（只在本 change 下写 delta；归档时再 sync）。
- 不修改已有 change `openspec/changes/m0-sdk-evidence-corrections/**`。
- 不重写 `docs/migration-plan.md` / `docs/m0-findings.md`（本轮文件边界不允许；E/A 的 findings 补丁留给后续）。
- 不引入官方尚未提供的预设 inspect API，不自建调试 dump 路由（除非负责人选 D-C）。
- 不调整里程碑范围，不新增工作项（D 的验收改写仍挂原 W-M1-3 / W-M1-4 / W-M4-7）。

## Impact

- 受影响工作项：W-M0-4（挂载日志）、W-M0-6（inject 应补进 findings）、W-M0-7（冒烟标记）、W-M1-3、W-M1-4、W-M2-1…7、W-M3-1、W-M3-3、W-M3-4、W-M4-2、W-M4-6、W-M4-7、W-M8-6。
- 本轮文档：`docs/dev-loop.md`、`docs/work-breakdown.md`。
- 代码：无。实现已按上述形态落地；本 change 是让契约追上代码。
- 风险：低（把错的写对）。产品决策四条若被否决，只需再开 change 改 SHALL，不必改已合并的实现——除非否决的是 H-A / I-A / G-A 且要求改行为。
