# 设计与证据

## 1. 真实环境如何搭起来的

复用 `scripts/smoke.mjs` 的隔离逻辑，起一个**长驻**实例（冒烟脚本会在断言完成后立刻杀进程，无法用于页面验证）：

- `mkdtemp` 出隔离 `DSH_HOME`，绝不碰真实 `~/.dsh`
- `dsh --profile web --dump-default-config` 生成默认 profile
- `runLinkProfile` 把 11 个包 link 进该 profile
- 写 overlay patch（`renderFriendOverlayPatch()`）把 11 个包插进插件清单
- `dsh web --patch <overlay> --port 3099`

host 侧输出与冒烟一致：11 条 `dsh-friend:plugin-mount`、`dsh-friend:preset-ready friend-companion` / `friend-companion-plus`、`dsh web: http://127.0.0.1:3099`。

**关键教训**：这一层全绿，客户端仍可能整体崩溃。

## 2. Cordis 客户端 context 的真实语义

报错文本出处：`node_modules/@deepseek-ai/cordis/lib/index.js`（搜 `cannot get property`）。代理在 **get** 阶段就抛，所以下面这种写法是**陷阱**：

```ts
// 危险：读 ctx.speechSynthesis 的瞬间抛错，`!== undefined` 永远轮不到
...(ctx.speechSynthesis !== undefined ? { speechSynthesis: ctx.speechSynthesis } : {}),
```

四个失败包与其未声明属性，与浏览器报错完全对应：

| 包 | 位置（修复前） | 未声明属性 |
|---|---|---|
| tts | `src/client.ts:83–91` | `speechSynthesis`、`createUtterance`、`onUiHint`、`onBoundary`、`player`、`volume`、`muted`、`autoSpeak`、`settingsScope` |
| asr | `src/browser.ts:84,85,112` / `:140` | `window` / `document`（严格 ctx 下**先**炸 `settingsScope`，因为整袋 ctx 被传进 `startAsrClient`） |
| settings | `src/client-register.ts:90` / `:217` | `document` / `location` |
| reactions | `src/client.ts:29` / `:43–44` | `EventSource` / `applyPerformance` |

**反证**：`dsh-friend-stage` 的 client 半区正常加载（真实页面上能看到它的悬浮层），因为它只读 `ctx.settingsScope`——而 stage 的 `package.json` 里 `dsh.client.inject` 声明了它。settings 也声明了 `slots` / `settingsScope`（那两个读没炸），但 `document` / `location` 没声明，照样炸。

因此正确的分界是：

- `ctx` 上只能有**真 dsh 客户端服务**（须同时出现在 `package.json` 的 `dsh.client.inject` 与模块的 `export const inject`）与 Cordis 自身 API（`effect`，mixin，不必声明）
- 浏览器全局从 `globalThis` 读，测试用显式 options 覆盖
- 回调/状态值一律 options

**不要**把 `speechSynthesis` / `volume` / `muted` 这类非服务名塞进 `dsh.client.inject` 去骗过代理——那是把测试缝伪装成平台契约。

## 3. 能抓住它的测试长什么样

现有单测用的是「宽松假 ctx」（普通对象，未定义属性返回 `undefined`），与真实语义**不同构**，所以 8 个里程碑都没抓到。

落地的守卫是一个**模拟真实语义的严格 ctx**：未声明属性的 getter 抛 `cannot get property "X" without inject`，已声明的返回给定值，`effect` 永远可用。

- 工厂：`packages/dsh-friend-shared/src/strict-cordis-ctx.ts`
- 逐包断言：`shared/strict-client-ctx.test.ts`（用各包的 `export const inject` 作为白名单）

**实证**：修复前该测试 4 failed / 6 passed，报错正是四个包各自的第一个未声明属性；修复后 10 passed。

**已知残留风险**：该测试用的是模块的 `export const inject`，**不读** `package.json` 的 `dsh.client.inject`。两处不一致时它测不出来——这正是浏览器门禁（L1）要补的洞。

## 4. 真实环境验证矩阵（本轮实测结论）

| 项 | 状态 | 证据 |
|---|---|---|
| host 11 包挂载 + 两预设就绪 | **已验证** | 真实 `dsh web` 日志 |
| `GET /friend/pet` 200 | **已验证** | curl + 页面 |
| 客户端半区全部加载 | **已验证（修复后）** | 页面无 `Failed to load plugins`，dsh 完整界面渲染 |
| 舞台悬浮层渲染与几何 | **已验证** | `#dsh-friend-float` 实测 `left:1628 top:708 280×360`，视口 1920×1080，未越界；拖拽条、气泡、快捷聊天输入、四角把手齐全 |
| pet 页嵌入 | **已验证** | overlay 内 iframe `src=/friend/pet?transparent=1&embed=1` |
| Live2D 许可门控安装界面 | **已验证** | pet 页渲染「安装官方 Live2D 示例模型」，列出缺失 `model`、`core`，含许可勾选与进度条 |
| Live2D 真渲染/口型 | **未验证（阻塞）** | `data-live2d-state="missing"`；需人工接受 Live2D 官方许可后下载，或用 Cubism Editor 从 `models/naiwa-live2d/layers/` 导出 `.moc3`（`export/` 为空，`tools/` 只有分层 PSD 脚本） |
| 伴侣真实回复 | **未验证（阻塞）** | 隔离 profile 无 API key，dsh 弹「添加一个 API Key 开始使用」 |
| TTS 真出声 / 首响 < 2s | **未验证** | 需真实会话 + 网络 |
| ASR 真识别 / 打断 | **未验证** | 需麦克风授权 |
| 壳内 endpoint 降级 | **未验证** | 需真机 WKWebView |

## 5. 另两处发布阻塞的根因

**包不可发布**：11 个包全部 `private: true` 且无 `license`。W-M8-8 的 `npm view 可见 11 包同版本` 在此前提下不可能达成，`release.yml --require-publishable` 会故意失败。

**依赖解包静默降级**：`pixi-live2d-display@0.4.0` 的 tarball 里 `package/cubism` 是 `drwxr--r--`、`package/cubism/.vscode` 是 `drw-r--r--`——**目录缺执行位无法进入**。macOS 上 pnpm 解包失败，该包留成空壳（只剩目录，没有 `dist` / `package.json`），于是 `lib/pet.iife.js` 静默降级、Live2D 整体失效。同一权限问题会让 `rm -rf` 也失败（需先 `chmod u+x` 那几个目录）。`packages/dsh-friend-stage/test/pet-iife-guard.test.ts` 会在降级时变红，但**构建本身不报错**，所以必须有前置检查把它变成显式失败。
