# 任务

本 change 起因是真实浏览器暴露的致命缺陷。第 1 节（代码修复）**已落地并复验**；第 2 节是本轮文档与 delta；第 3 节是尚未闭环、需要后续工作项的部分。

## 1. 已落地的代码修复（真实浏览器已复验）

- [x] 1.1 四个客户端半区不再从 `ctx` 读非服务属性（tts / asr / settings / reactions）
  - 验收：真实 `dsh web` 打开根路径，页面**不含** `Failed to load plugins`，dsh 完整界面渲染
  - 回链：W-M2-4、W-M3-1、W-M7-6、W-M8-3
- [x] 1.2 严格 Cordis ctx 假件与逐包加载断言
  - 验收：`packages/dsh-friend-shared/src/strict-cordis-ctx.ts` 未声明属性 getter 抛错；`shared/strict-client-ctx.test.ts` 修复前 4 failed、修复后全绿
  - 回链：W-M0-2、W-M0-7
- [x] 1.3 全仓审计其余客户端半区与 host 半区无同类写法
  - 验收：stage / shared / growth / memory / persona 的 `apply` 不读未声明 ctx 属性；`pnpm test` / `typecheck` / `aggregate --check` / `package-boundary` / `smoke` 五项退出码 0
  - 回链：W-M0-2、W-M0-6

## 2. 本轮文档与 delta（无业务代码）

- [x] 2.1 新建 change `client-load-live-evidence` 并写 proposal / design / distribution delta
  - 验收：`openspec validate client-load-live-evidence --strict` 退出码 0
  - 回链：W-M0-2、W-M0-7、W-M8-6、W-M8-8
- [x] 2.2 `docs/dev-loop.md` 补两节：真实浏览器验证怎么起长驻实例；`pixi-live2d-display` 解包失败的症状/根因/修复步骤
  - 验收：文中给出可照抄的命令，并写明 host 挂载行 + 路由 200 **不是**客户端可用的证据
  - 回链：W-M0-4、W-M0-7、W-M4-8
- [x] 2.3 `docs/work-breakdown.md` 的 W-M0-7 增加浏览器级门禁；W-M8-8 标注可发布性前置
  - 验收：W-M0-7 验收含「页面无 `Failed to load plugins`」；W-M8-8 注明 `license` / `private` / `publishConfig` 为前置
  - 回链：W-M0-7、W-M8-8
- [x] 2.4 修 `scripts/smoke.mjs` 挂载行断言竞态
  - 背景：stage 能在其后挂载的包冲刷 mount 行**之前**就应答 `/friend/pet`，导致 `startup logs missing plugin mounts` 偶发误报（接在 browser-smoke 后连跑时实际发生过一次）
  - 验收：挂载行断言与 preset-ready 一样走 `waitUntil` 轮询；`node scripts/smoke.mjs` 退出码 0
  - 回链：W-M0-7

## 3. 后续工作项

- [x] 3.1 恢复 TTS/ASR 客户端的 `settingsScope` 实时绑定
  - 背景：修复崩溃时为避免二次崩溃，两个包曾完全不读 `ctx.settingsScope`，web 客户端上音量/静音/autoSpeak/热键/引擎的热同步一度失效
  - 做法：`dsh.client.inject` 与模块 `export const inject` 同时加 `settingsScope`，`apply()` 把 `ctx.settingsScope` 传进 `startTtsClient` / `startAsrClient`
  - 验收：严格 ctx 下只注入 `settingsScope` 时热同步路径成立；浏览器门禁在含新绑定的构建上退出码 0（页面无 `Failed to load plugins`）
  - 残留：真实浏览器里逐项点设置看即时生效**尚未做**（需人工操作配置中心）
  - 回链：W-M2-4、W-M3-1、W-M8-3
- [x] 3.2 浏览器级门禁进 CI（决策 L1 按 L-A 落地）
  - 验收：`scripts/browser-smoke.mjs` 用 Playwright 断言页面无 `Failed to load plugins` 且 9 个 client 半区在 boot graph 内；人为让 tts 读 `ctx.speechSynthesis` 时变红并指名到包与属性，恢复后变绿（已实证）
  - 残留：`ci.yml` 里「装 dsh CLI + 缓存 Chromium」这套**尚未在 GitHub Actions 上真跑过**
  - 回链：W-M0-7
- [x] 3.3 包可发布性（决策 L2 按 L-A 落地）
  - 验收：11 包均有 `license`、无 `private: true`、声明 `publishConfig.access`、版本一致；`release-scan --pack` 退出码 0
  - 回链：W-M8-6、W-M8-8
- [x] 3.4 依赖解包前置检查
  - 验收：`scripts/check-pixi-live2d.mjs` 在 `dist` 缺失/为空时显式失败并给出修复步骤，而不是产出降级的 `lib/pet.iife.js`
  - 回链：W-M4-8、W-M0-7
- [x] 3.5 严格 ctx 测试与 `package.json` 的 `dsh.client.inject` 对齐守卫
  - 背景：现有严格测试只读模块的 `export const inject`，两处不一致时测不出来
  - 验收：新增守卫断言两处一致；人为改一处不一致时变红
  - 回链：W-M0-2
- [ ] 3.6 Live2D 真渲染验收
  - 前置：**负责人已接受** Live2D 官方许可（2026-08-14）。下载仍由本人在 pet 页勾选并点「下载并启用 Live2D」完成，专有文件不进 git
  - 验收：pet 页 `data-live2d-state` 不再为 `missing`，模型渲染且口型随 TTS 变化
  - 回链：W-M4-2、W-M4-8
- [ ] 3.7 零 key 北极星闭环实测（**阻塞在人工事项**）
  - 前置：需要一个可用的 DeepSeek API key（隔离 profile 无 key，dsh 会拦在「添加一个 API Key 开始使用」）
  - 验收：说话 → 伴侣回答 → Edge TTS 出声 → 口型同步，首响 < 2s
  - 回链：W-M1-6、W-M2-2、W-M4-8
