# dsh-Friend

dsh 上的人格化伴侣插件：角色卡、语音、Live2D 舞台、本地明文记忆、成长故事、工作陪伴反应，以及一个只负责窗口的桌面薄壳。

**Derived from [Kokoro Engine](https://github.com/chyinan/Kokoro-Engine)**（MIT, © 2026 chyinan）。本仓库是 TypeScript / dsh 插件形态的衍生作品，根 `LICENSE` 保留原版权行并追加本项目行。

> 仓库 GitHub topic 建议加 `dsh-plugin`（需仓库管理员在 GitHub 设置，无法用提交完成）。

## 安装

npm 上的 `@wish233/dsh-friend-*` **还没发过版**。请用源码 + 本地链接挂进正在用的 `dsh web`：

```bash
export CI=true
cd /path/to/dsh-Friend
pnpm install
pnpm -r build
node scripts/link-profile.mjs
# 若 3080 上已有 dsh web，先停掉再执行下一行
dsh web --patch packages/dsh-friend-all/cordis.patch.yml
```

预期：`dsh web` 日志里出现 11 条 `dsh-friend:plugin-mount`、2 条 `dsh-friend:preset-ready`，并且 `GET http://127.0.0.1:3080/friend/pet` 返回 200。逐步说明见 [docs/dev-loop.md](docs/dev-loop.md)。

将来 registry 发布后，目标安装形态是：

```bash
dsh plugin --profile web add @wish233/dsh-friend-all
```

这条命令**尚未**在干净机器上跑通，不要把它当成已经验证过的安装路径。

桌面壳（可选，需本机 Rust）：`cd apps/friend-shell && cargo run`。dsh 未启动时显示引导页，起来后自动切到 `/friend/pet`。

## 30 秒能看见什么

计划里的「说话 + 口型」演示 GIF **还没有**。口型、Edge TTS、悬浮层拖拽等能力只有单测或手册步骤，**没有**真实浏览器录屏，也没有真机验收。打开 `/friend/pet` 只能确认路由 200 和页面能加载，不能据此说「已经能语音对话」。

## 能力域

| 域 | 包 | 现在能信什么 |
|---|---|---|
| 伴侣会话 / 角色卡 | `dsh-friend-persona` | 存储、酒馆卡导入、双预设、人格分区：**单测** |
| 语音输出 | `dsh-friend-tts` | provider / 队列 / 预处理 / 播放器：**单测**；Edge 真合成需 `EDGE_LIVE=1`，默认 CI 不跑 |
| 语音输入 | `dsh-friend-asr` | 三模式状态机、快捷键、打断：**单测**；Chrome Web Speech / 壳内 endpoint **未做真机** |
| 形象舞台 | `dsh-friend-stage` | 渲染核、标签、表演工具、资产下载器：**单测**；Live2D 待机与口型 **未做真浏览器** |
| 记忆 | `dsh-friend-memory` | 文件层、检索、工具、小结 / 蒸馏：**单测** |
| 成长 | `dsh-friend-growth` | 纯函数与流水线：**单测** |
| 工作陪伴 | `dsh-friend-reactions` | 过滤与节流：**单测** |
| 配置中心 | `dsh-friend-settings` | 卡片 / 十分区壳 / 壳心跳路由：**单测** |
| 视觉 seam | `dsh-friend-perception` | 预留，v1 无实现 |
| 聚合 | `dsh-friend-all` | patch + 依赖清单，`aggregate --check` 守漂移 |
| 桌面壳 | `apps/friend-shell` | 窗口 / 探测 / 心跳 / 快捷键 / 托盘：**Rust 单测**；macOS 置顶透明等 **手册未跑** |

和 [dsh-pet](https://github.com/deepseek-ai/dsh-pet) 的区隔：dsh-pet 是工作台吉祥物；dsh-Friend 是带人格、记忆和语音的伴侣。两者可以同屏，悬浮层默认避让。

## 隐私

记忆是**本机明文** Markdown（`MEMORY.md`、`memory/YYYY-MM-DD.md`、`USER.md`），不是加密库。工作陪伴只读会话事件的类型 / 时长 / 成败，不读文件内容和用户正文。TTS / ASR 的 API key 只留在 host settings，不应下发到 client（见下方待拍板的 G5）。

Live2D Cubism Core 与样例模型**不进 git、不进 npm 包**。首次使用由 host 下载到本机 `vendor/`。台账：[docs/assets-compliance.md](docs/assets-compliance.md)。发布物按**文件名**扫描，见 [docs/release.md](docs/release.md)。

## 已知限制

这一节是给「按 README 从零装到能语音对话」的人看的，请按字面读，不要把单测绿当成产品已验证。

1. **大量功能只有单测覆盖。** 上表里标了「单测」的路径（角色卡、TTS 队列、ASR 状态机、舞台标签、记忆蒸馏、成长流水线、反应节流、配置中心表单……）在 CI 里是 `vitest` / `cargo test` 绿。那只说明给定 fixture 时函数行为符合契约，**不**说明你在 Chrome、Safari 或桌面壳里点下去会成功。

2. **北极星闭环（说话 → 回答 → 出声 → 口型）还要你自己测。** 隔离 profile 没有 API key。`scripts/smoke.mjs` 只断言挂载行和 `GET /friend/pet` 200；`scripts/browser-smoke.mjs` 断言页面能加载且悬浮层可抓。没有干净 macOS dmg / Windows msi 的真机记录。

3. **四条产品决策还没拍板。** 实现按提案默认值写进了代码，负责人可以改选。清单在 `openspec/changes/m1-m4-implementation-evidence/proposal.md`：
   - **D1** — rc.6 无法进程外 inspect 预设工具 / 提示词时，隔离验收怎么写（默认 D-A：单测 + 伴侣会话行为 + 人工抽查编码会话）。
   - **H3** — Safari 上的 Web Speech 信不信（默认 H-A：只信 Chromium，Safari 报不可用）。
   - **I1** — 形态合法但词不在表内的舞台标签（默认 I-A：仍剥离、不应用）。
   - **G5** — 若 dsh 把整个 `friend-tts` namespace 同步给 client，key 泄漏窗口怎么收（默认 G-A：client 只读 decode 后的 `value`；synthesize opts 带 key 一律禁止，这一条已确定）。

4. **包还没发过 npm。** 11 个包已具备 `license` / `publishConfig`，发布仍靠 tag 触发的 `release.yml`，需要仓库配置 `NPM_TOKEN`。

5. **没有演示 GIF，也没有「10 分钟从零到语音对话」的实测。** W-M8-7 的手册计时验收未做。Edge TTS 默认零 key，但那条路径没有在本机浏览器里点过「试听」。

6. **合规扫描按文件名，不按字符串。** `lib/pet.iife.js` 合法引用全局名 `Live2DCubismCore`。CI 跑 `node scripts/release-scan.mjs --pack`，禁止的是 `.moc3` / `.model3.json` / `live2dcubismcore.min.js` 这类**文件**。

7. **GitHub Actions 工作流没有在真实 CI 上跑过本轮改动。** YAML 只做了本地语法核对。`release.yml` 需要仓库配置 secrets 之后才会真发布，见 [docs/release.md](docs/release.md)。

## 开发

```bash
export CI=true
pnpm test
pnpm typecheck
node scripts/aggregate.mjs --check
node scripts/release-scan.mjs --pack
node scripts/smoke.mjs
```

壳：`cd apps/friend-shell && cargo test`。发布与 secrets：[docs/release.md](docs/release.md)。素材授权：[docs/assets-compliance.md](docs/assets-compliance.md)。
