# 任务

本 change 是契约回写：业务代码已按证据落地。任务分「本轮文档」「已落地实现的契约核对」「归档与后续」。

## 1. 本轮文档与 delta（无业务代码）

- [x] 1.1 新建 change `m1-m4-implementation-evidence` 并写 proposal / design / 五份 delta spec
  - 验收：`openspec validate --specs` 与 `openspec validate m1-m4-implementation-evidence --strict` 退出码 0
  - 回链：W-M1-3、W-M1-4、W-M2-*、W-M3-1/3/4、W-M4-2/6/7、W-M0-4/6/7
- [x] 1.2 更新 `docs/dev-loop.md` 启动日志判据（C）
  - 验收：文中不再把 `[@wishp3/dsh-friend-shared] apply()` 当作挂载证明；写明 `dsh-friend:plugin-mount <包名>` 与 `dsh-friend:preset-ready <预设 id>`
  - 回链：W-M0-4、W-M0-7
- [x] 1.3 更新 `docs/work-breakdown.md` 的 A/B/J 与 D 验收改写
  - 验收：W-M4-7 改动点不再写 zod、路径为 `src/tools.ts`；W-M4-6 路径为 `src/tag-parser.ts`；W-M4-2 验收改为按文件扫描；W-M1-3 / W-M1-4 / W-M4-7 验收改为 mock+行为+manual，并注明待官方 inspect 升级
  - 回链：W-M1-3、W-M1-4、W-M4-2、W-M4-6、W-M4-7
- [x] 1.4 W-M0-6 增加 Cordis `inject` 指针（E；本轮不改 `docs/m0-findings.md`）
  - 验收：W-M0-6 改动点列出第 ⑥ 项 inject，并指向本 change design
  - 回链：W-M0-6

## 2. 已落地实现（契约核对，不改代码）

> 下列为 M1–M4 已实现并经验收者；本 change 只要求 delta 与之一致。

- [x] 2.1 表演工具使用 `ParameterSchemaSpec`，`output.schema` + `output.render` 必填（A）
  - 验收：`packages/dsh-friend-stage/src/tools.ts` 无 zod；单测覆盖词表外拒绝
  - 回链：W-M4-7
- [x] 2.2 启动标记 `dsh-friend:plugin-mount` 与 `dsh-friend:preset-ready`（C）
  - 验收：shared helper 与 persona `formatPresetReadyLog` 存在；冒烟脚本按行匹配
  - 回链：W-M0-7、W-M1-4
- [x] 2.3 persona / tts / stage 导出 `inject`（E）
  - 验收：分别为 `['agentPresets','systemPrompt','tools']`、`['webServer']`、`['webServer','tools']`
  - 回链：W-M1-4、W-M2-5、W-M4-7
- [x] 2.4 shared 三出口与包边界守卫（F）
  - 验收：`shared/package-boundary.test.ts` 与 `packages/dsh-friend-shared/test/universal-entry.test.ts` 绿
  - 回链：W-M0-1、W-M0-5
- [x] 2.5 TTS 缓存键、三级降级、fallback 指令、`friend-tts`、opts 无 `apiKey`、`ws@8.21.3`（G）
  - 验收：对应 tts 单测绿（cache / router / openai / settings-key-leak）
  - 回链：W-M2-1、W-M2-2、W-M2-3、W-M2-5
- [x] 2.6 ASR 内置快捷键黑名单、`onBargeIn`、Safari 报不可用（H）
  - 验收：hotkey / session / webspeech 单测绿
  - 回链：W-M3-1、W-M3-3、W-M3-4
- [x] 2.7 舞台标签三类策略与 48 字符上限（I）
  - 验收：`packages/dsh-friend-stage/src/tag-parser.ts` 单测覆盖未知词剥离、非法透传、过长释放
  - 回链：W-M4-6

## 3. 负责人拍板与归档（本轮不做）

- [x] 3.1 批复 proposal「需人工确认的决策」四条（2026-08-14）
  - 拍板：D-A / H-A / I-A / G-A。其余生产接线项维持现状（D1-A 别名、D2 不改 preset、D3-A 隐藏 `toolLongMs`、试听钉死 provider 走 D4-A）
  - H-A 配套：README 写明 Safari 语音输入暂不支持，后续会补
  - 回链：W-M1-3、W-M1-4、W-M3-1、W-M4-6、W-M2-3
- [ ] 3.2 归档本 change 并 sync 主 spec（先归档或合并 `m0-sdk-evidence-corrections`，避免重叠 Requirement 丢场景）
  - 验收：`openspec/specs/` 下五域含本 delta 终态；主 spec 无 `## ADDED/MODIFIED` 标题
  - 回链：W-M8-7
- [ ] 3.3 把 E（inject）与 A（defineTool ≠ zod / ≠ schemastery）补进 `docs/m0-findings.md`
  - 验收：findings 有独立条目，带 `文件:行号` 证据，不再写「parameters 是 schemastery 风格」
  - 回链：W-M0-6
- [ ] 3.4 W-M3-4 把门面 `stopAll()` 接到 `onBargeIn`（实现若尚未接线则在 M3 收口时完成）
  - 验收：listening + bargeIn 开启时 AudioContext 与 speechSynthesis 两路均停
  - 回链：W-M3-4、W-M2-4、W-M2-7
- [ ] 3.5 官方提供预设 inspect 后，把 D 的 manual 场景升级为自动断言
  - 验收：编码会话提示词与 companion 工具列表可在 CI 中进程外断言
  - 回链：W-M1-3、W-M1-4、W-M4-7
