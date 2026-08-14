# 用真实浏览器证据校正客户端半区契约与门禁

## Why

M1–M8 的单测、typecheck、`aggregate --check`、`scripts/smoke.mjs` 全绿，冒烟还能确认 11 条 `dsh-friend:plugin-mount`、两条 `dsh-friend:preset-ready` 与 `GET /friend/pet` 200。但**第一次把真实 `dsh web` 开进浏览器**，页面上只有：

```
Failed to load plugins
@wish233/dsh-friend-tts
@wish233/dsh-friend-asr
@wish233/dsh-friend-reactions
@wish233/dsh-friend-settings
failed to apply loader entry 800dcc2e (@wish233/dsh-friend-tts): cannot get property "speechSynthesis" without inject
```

整个 dsh 界面没有渲染，11 个包里有 4 个客户端半区**完全加载失败**——配置中心、语音输出、语音输入、工作反应在浏览器里一行都没跑起来。

两件事同时暴露：

1. **契约漏了一半**。`m1-m4-implementation-evidence` 的「Cordis inject 硬性声明」只约束了 **host 半区**。客户端半区同样跑在 Cordis 代理上，同样会在读未声明属性时抛错，但没有任何 SHALL 覆盖它。
2. **门禁漏了一层**。host 打印了挂载行、路由回了 200，**不代表**客户端半区能加载。现有 CI 与冒烟在这条失败上是**全绿的**，因为没有任何检查真的打开过浏览器。`scripts/smoke.mjs` 头部注释本就写着「Playwright e2e 推迟到 M1/M8」——这个推迟直接导致 4 个半区带着致命缺陷通过了 8 个里程碑。

顺带另外两处发布阻塞也在同一轮真实环境核查中确认：11 个包全部 `private: true` 且无 `license` 字段（`npm view 可见 11 包同版本` 不可能达成）；`pixi-live2d-display@0.4.0` 的 tarball 含**没有执行位的目录**，macOS 上 pnpm 解包会静默留下空壳，导致 `lib/pet.iife.js` 降级成半成品。

## What Changes

四条按证据回写。**本 change 只改契约与门禁指引**；对应的业务代码修复已经落地并在真实浏览器复验通过。

1. **A. 客户端 context 契约（扩写现有 inject 要求）**。inject 规则 SHALL 同时约束 client 半区。更强的一条：`ctx` **只**承载已声明的 dsh 客户端服务（`settingsScope` / `slots` 等）与 Cordis 自身 API（`effect`）；浏览器全局（`window` / `document` / `location` / `EventSource` / `speechSynthesis`）与测试注入缝（回调、播放器、音量等）SHALL 走显式 options 参数，**禁止**从 `ctx` 上读。写成 `ctx.foo !== undefined ? ... : ...` 不是安全写法——**读的那一刻就抛**。
2. **B. 客户端真实加载门禁**。CI SHALL 有一层浏览器级检查：启动真实 `dsh web`、加载客户端、断言页面**不含** `Failed to load plugins` 且全部客户端半区加载成功。host 挂载行与路由 200 SHALL NOT 被当作客户端半区可用的证据。
3. **C. 包可发布性闸门**。11 个包 SHALL 有 `license` 字段、SHALL NOT 为 `private: true`、scope 包 SHALL 声明 `publishConfig.access`；发布前检查 SHALL 二值判定可发布性，而不是等 `pnpm publish` 失败。
4. **D. 依赖解包完整性**。构建 SHALL 有前置检查确认 `pixi-live2d-display` 的 `dist` 与 `package.json` 真实存在且非空；坏掉时 SHALL 明确报错并给出修复步骤，SHALL NOT 静默产出降级的 `lib/pet.iife.js`。根因（tarball 内目录缺执行位）与修复步骤 SHALL 写进 `docs/dev-loop.md`。

受影响工作项：W-M0-2（client 半区产物契约）、W-M0-7（CI 与冒烟）、W-M2-4、W-M3-1、W-M7-6、W-M8-1、W-M8-3（四个失败半区）、W-M8-6、W-M8-8（可发布性与流水线）、W-M4-8（pet IIFE 完整性）。

## Non-goals

- **不**改这四个包的功能行为。本轮修复只把「从 ctx 读非服务属性」换成 options/`globalThis`，不动任何业务逻辑。
- **不**在本 change 里补 TTS/ASR 客户端的 `settingsScope` 绑定。修复时为避免二次崩溃，两个包暂时完全不读 `ctx.settingsScope`；恢复实时绑定需要同时改 `dsh.client.inject`、`export const inject` 与 `apply()`，属于后续工作项（见 tasks 第 3 节）。
- **不**降低现有 host 侧冒烟判据。浏览器门禁是**增加**一层，`dsh-friend:plugin-mount` / `preset-ready` 判据保持不变。
- **不**处理 Live2D 真渲染验收。它阻塞在人工事项上（接受 Live2D 官方许可、用 Cubism Editor 导出 `.moc3`），不是代码问题。
- **不**改 `docs/m0-findings.md`（沿用上一轮 change 的文件边界；归档后统一补）。

## 需人工确认的决策

### L1. 浏览器门禁用什么实现，放在哪一层

**背景**：仓库当前**没有**任何浏览器自动化依赖（`node_modules/.bin` 无 playwright，四个 workflow 均未引用）。加这层门禁必然引入新依赖与 CI 时间。

| 选项 | 做法 | 利 | 弊 |
|---|---|---|---|
| **L-A（提案默认）** | 新增 `@playwright/test`（或 `playwright-core` + 系统 Chromium），写 `scripts/browser-smoke.mjs`：复用 `smoke.mjs` 的隔离 profile 启动 `dsh web`，Chromium 打开根路径，断言无 `Failed to load plugins` 且 11 个客户端半区加载；接进 `ci.yml` 作为合并前置 | 能真正拦住本轮这类致命缺陷；一次投入长期收益 | CI 需装浏览器（缓存后约 +1–2 min）；新增 devDependency |
| **L-B** | 不用真浏览器，改为在 Node 里模拟 `__ModuleLoader__` 与严格 Cordis 代理，加载各包 `lib/client.js` 并断言 apply 成功 | 无浏览器依赖、秒级 | 模拟的 loader 与真实 dsh 客户端会漂移；本轮真实报错来自 dsh 自己的 loader，模拟不一定同构 |
| **L-C** | 只保留已落地的严格 ctx 单测（`shared/strict-client-ctx.test.ts`），不加浏览器层 | 零成本 | 严格 ctx 单测只覆盖「已知的 inject 列表」；`dsh.client.inject` 与 `export const inject` 不一致、或 dsh 换 loader 语义时仍会漏 |

**注**：L-A 与 L-B 不互斥；严格 ctx 单测（已落地）在任一选项下都保留。请选 L-A / L-B / L-C。默认按 L-A 落笔。

### L2. 11 个包现在就解除 `private`，还是等首次发布前再解

**背景**：W-M8-8 的 DoD 要求 `npm view` 可见 11 包同版本；`release.yml` 的 `--require-publishable` 闸门现在会**故意失败**。解除 `private` 后，任何人在本地误跑 `pnpm publish -r` 就能推到 npm（`@wish233` scope 需要发布权限，但仓库协作者可能有）。

| 选项 | 做法 | 利 | 弊 |
|---|---|---|---|
| **L-A（提案默认）** | 现在就加 `license` + `publishConfig.access: public` 并去掉 `private`，靠 tag 触发的 `release.yml` 控制真实发布时机 | W-M8-6/8 的检查项现在就能变绿；发布链路可端到端演练 | 误发布风险从「不可能」变成「靠流程约束」 |
| **L-B** | 现在只加 `license` 字段，保留 `private: true`，首次发布前再统一解除 | 误发布不可能 | `--require-publishable` 与 W-M8-8 DoD 继续红，无法端到端演练发布链路 |

请选 L-A / L-B。默认按 L-A 落笔。
