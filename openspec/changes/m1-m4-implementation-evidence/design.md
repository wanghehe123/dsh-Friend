# 设计说明：为什么按实现证据改契约

## Context

见 `proposal.md` 的 Why。第一版 spec 是实现前的目标契约；M1–M4 按 rc.6 真实 SDK 与两次冒烟失败改了代码，主 spec / WBS / `docs/dev-loop.md` 未跟上。本 change **只回写契约与实现指引**，实现已经在对应包里。

并行的 `m0-sdk-evidence-corrections` 尚未归档。本 change 里凡 MODIFIED 到同一条 Requirement 的（`伴侣 Agent 预设`、`队列与缓存`、`合规资产下载`），delta 写的是 **m0 校正 + 本轮证据** 的合并终态，避免后归档的 change 把先归档的场景盖掉。

## Goals / Non-Goals

**Goals:**

- 让 delta spec 描述 rc.6 下真实可观察、可测试的行为。
- 把「测不到却写成 int」的验收改成现在能做的路径，并留官方 inspect 升级口。
- 把启动日志、inject、shared 出口这些实现约定写成契约，避免下一里程碑再踩。
- 实现指引文档（WBS、dev-loop）与代码布局/判据对齐。

**Non-Goals:**

- 不改业务代码、不自建 inspect 旁路、不归档、不同步主 spec。
- 不在本轮修改 `docs/m0-findings.md`（文件边界）；inject 与 defineTool≠zod 的 findings 补丁留给后续工作项。
- 不把提案里四条待确认决策假装已批准；delta 按实现现状写 SHALL，否决后另开 change。

## Decisions

### 1. 验收改写而不是删除（D-A）

隔离意图（编码会话零污染、工具白名单）仍然成立，缺的是**观测手段**。mock 组装管线已经存在（`packages/dsh-friend-persona/test/apply.test.ts`），伴侣会话内触发工具也是产品路径。把 int 拆成 unit + 行为 int + manual，比删掉验收或阻塞在上游 API 更可执行。

备选 D-B（整项延期）会卡住 M1/M4 收口；D-C（自建 dump 路由）会把非产品 API 做成契约。默认 D-A，待负责人确认。

### 2. inject 写成总则 + 各包清单

Cordis 的失败模式是「读属性就抛」，不是「服务缺失返回 undefined」，所以无法靠防御性 `if (ctx.x)` 绕过。两次冒烟已经证明漏写会拖垮整树。总则放 `distribution`，persona/tts/stage 各自列出当前 `inject` 数组，避免以后只改一个包时找不到契约。

### 3. 工具 DSL 同时写进 stage 与 distribution

W-M4-7 是眼前的表演工具；记忆三件等后续工具会复制这份错误（WBS 仍写 zod）。`distribution` 的 ADDED 条把 `ParameterSchemaSpec` 变成跨包规则，stage 条约束表演工具的词表与 output 必填。

### 4. 合规扫描按文件而不是字符串

`pixi-live2d-display` 必须调用全局 `Live2DCubismCore`。禁止的是 **Core 二进制与 `.moc3` / `.model3.json` 进包**，不是禁止这个标识符出现在 JS 里。字符串 `rg` 与合规目标不一致，会逼实现去改合法引用。

### 5. TTS 打断用门面

W-M2-4 与 W-M2-7 是两条独立播放管线。ASR 若只调其中一路 `stopAll()`，另一路会继续出声。门面是唯一对外打断入口；ASR 本包先停在 `onBargeIn` 回调，W-M3-4 负责接线——这样 M3 单测不必加载 AudioContext。

### 6. 标签三类而不是「合法/非法」二分

「非法透传」若把未知词也当非法，协议形标签会漏进气泡和朗读。若把 `array[0]` 当标签，正文会被吃掉。形态（`[expr|motion|cue:<token>]`）与词表是两层判断；48 字符上限防止未闭合 `[` 永久缓冲。默认 I-A，待确认。

### 7. key：opts 禁止携带；client 只读 decode 后的 value（G-A）

opts 带 key 会让 key 进入队列日志、错误对象和任何把 opts 推到 client 的路径，这条不征求意见。namespace 同步风险尚未被 rc.6 证实，先用消毒 +「只读 value」契约；若负责人选 G-B，再拆 host-only namespace。

## Risks / Trade-offs

- [并行 change 归档顺序] → 重叠 Requirement 已写合并终态；归档时先 m0 后本 change，或只归档本 change（终态已含 m0 表述）。
- [D-A 的 manual 缺口] → 编码会话零污染在 rc.6 不是全自动；里程碑收口必须显式勾 manual，不能只看 CI。
- [G-A 泄漏窗口] → 若 dsh 同步 raw `base/user`，client 消毒函数覆盖不到。缓解：单测快照 + 代码审查禁止读 `base/user`；升级见 G5。
- [H-A 排除 Safari] → 桌面 Safari 用户必须配 endpoint。与壳内 WebView 降级一致，但要在设置页写清原因。
- [本轮不改 m0-findings] → 后续实现者仍可能只读 findings 而漏 inject。缓解：WBS W-M0-6 加一句指针；归档后补 findings。

## Migration Plan

无需运行时迁移。本 change 落地步骤：

1. 评审四条待确认决策（proposal 专节）。
2. 本轮已改 / 将改：`docs/dev-loop.md`、`docs/work-breakdown.md`。
3. 归档本 change 时再 sync 主 spec（`openspec-sync-specs` / archive）。
4. 另开小项：把 E 与「defineTool ≠ zod / ≠ schemastery」补进 `docs/m0-findings.md`。

回滚：删除本 change 目录即可；不涉及数据与发布物。

## Open Questions

无额外可延后问题。会改变 SHALL 的四条已列为提案决策，等负责人一次性拍板。
