# dsh-Friend 开发循环

把本仓 11 个包的 `lib/` 构建产物，用 symlink 挂进 dsh profile 的 `node_modules`，让 `dsh web` 加载**本地开发版**而不是 registry 上的包。

## 0. 一条必须记住的环境变量

本机 pnpm 11 **没有 TTY 时会直接退出**：

```text
ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
```

**所有 pnpm 命令前都要先：**

```bash
export CI=true
```

GitHub Actions 会自动带 `CI=true`；本仓 workflow 仍然显式写了 `env: CI: true`，避免用 `act` 等本地模拟器时踩同一坑。把这行放进 shell profile 最省事。

## 1. 首次准备

```bash
export CI=true
pnpm install
pnpm -r build
node scripts/link-profile.mjs          # 默认 --profile web
dsh web
```

`link-profile` 做的事情：

```text
~/.dsh/profiles/<profile>/node_modules/@wish233/dsh-friend-<name>
  → <repo>/packages/dsh-friend-<name>
```

- `--profile <name>`：默认 `web`（也就是 `dsh web`）。也认 `$DSH_HOME`（默认 `~/.dsh`）。
- `--dry-run`：只打印 `linked / skipped / would link`，**不落盘**。
- `--unlink`：拆掉本脚本创建的 symlink，还原；真实目录不会动。

如果 profile 目录还不存在，脚本会退出码非 0，并提示先跑一次 `dsh web`（`web` / `headless` 会在首次启动时自动初始化；其它名字要用 `dsh plugin --profile <name> …`）。

如果某个包还没有 `lib/`，会提示先 `export CI=true && pnpm -r build`，并且**不会**写任何链接。

## 2. 日常循环（改码 → 看见变化）

dsh 加载的是各包 `lib/`，不是 `src/`。改 TypeScript 之后必须重新构建被改的包：

```bash
export CI=true
pnpm --filter @wish233/dsh-friend-stage build
# 刷新浏览器
```

过滤名是 npm 包名。11 个包：

| 包 | 典型改动 |
|---|---|
| `@wish233/dsh-friend-shared` | compat、SSE、schema |
| `@wish233/dsh-friend-persona` | 角色卡、预设 |
| `@wish233/dsh-friend-memory` | 记忆 |
| `@wish233/dsh-friend-tts` | 语音输出 |
| `@wish233/dsh-friend-asr` | 语音输入 |
| `@wish233/dsh-friend-stage` | Live2D / pet 页 |
| `@wish233/dsh-friend-growth` | 人生故事 |
| `@wish233/dsh-friend-reactions` | 工作陪伴反应 |
| `@wish233/dsh-friend-settings` | 设置卡 / 配置中心 |
| `@wish233/dsh-friend-perception` | 视觉 seam |
| `@wish233/dsh-friend-all` | 聚合 bundle（patch + 依赖清单） |

改了 `shared` 时，依赖它的包不必重编（它们 `neverBundle` 运行时引用 workspace 包），但 **shared 自己要 build**。改了某个功能包的 `src/index.ts`（host）或 `src/client.ts`（client）只 build 那一个包即可。

目标是：改码 → 单包 build → 刷新浏览器，**30 秒内**能看见变化。

## 3. 常见坑

### 3.1 `CI=true` 与 TTY

pnpm 11 在「要删 `node_modules` 但当前不是 TTY、也没有 `CI=true`」时会中止，报 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`。编辑器任务、后台脚本、部分 Cursor/agent 终端都会踩中。

对策：任何 `pnpm install` / `pnpm -r build` / `pnpm --filter … build` 之前 `export CI=true`。

### 3.2 pnpm 11 的 `minimumReleaseAge`（新发布的 `@deepseek-ai/*` 装不上）

pnpm 11 默认 **24 小时新鲜度窗口**：包发布后 24h 内不会被安装。dsh 的 RC 经常在这个窗口里发版，于是 `pnpm install` 在 `CI=true` 下不会弹出「要不要排除」的交互提示，直接失败。

本仓已经在 `pnpm-workspace.yaml` 里写了：

```yaml
minimumReleaseAgeExclude:
  - '@deepseek-ai/*'
```

**不要删这行。** 周 canary（`.github/workflows/canary.yml`）还会额外把 `minimumReleaseAge` 置 0，专门用来抓「刚发布就破坏我们」的上游变更。

### 3.3 symlink 下 Node 解析回退到 npm 行为 →「改了没生效」

dsh 的模块解析是双锚点：

1. **profile 自己的** `~/.dsh/profiles/<name>/node_modules`（`dsh plugin add` 装的外包，也是 `link-profile` 写 symlink 的地方）。
2. 再沿父目录走到 **`$DSH_HOME/profiles/node_modules`**：这是 dsh 启动时 `healProfilesModuleFallback` 维护的**扁平 fallback**，每个安装体依赖一条约 symlink，走的是 Node 默认的「跟随 symlink + 父目录 walk」，看起来很像 npm 的扁平 `node_modules`。

`link-profile` 把包链到第 1 层。Node **默认会 realpath 跟随 symlink**，所以 host 半区会从**本仓**的 `packages/<pkg>/lib/` 加载，依赖也从本仓 `node_modules` 解析——这是我们要的。

会「改了没生效」的几种情况：

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 改了 `src/` 刷新没变化 | dsh 加载的是 `lib/` | 重新 `pnpm --filter <pkg> build` |
| 链接过，但日志里仍是旧行为 | 进程带着 `--preserve-symlinks` 启动，或 profile 里根本没链上，解析掉进了 `$DSH_HOME/profiles/node_modules` 那份**安装体**拷贝 | `ls -l ~/.dsh/profiles/web/node_modules/@wish233/` 确认是指向本仓的 symlink；重启 `dsh web` |
| `dsh plugin add @wish233/dsh-friend-all` 之后 link-profile 报错 | pnpm 在同一路径放下了**真实目录**或指向 store 的外来 symlink。`link-profile` **拒绝覆盖**，以免 `rm -rf` 用户数据 | 先 `dsh plugin --profile web remove @wish233/dsh-friend-all`（或把真实目录自己挪走），再跑 link-profile |
| 只重启了浏览器 | host 半区在 Node 进程里，不会热替换 | 重启 `dsh web` |

`link-profile` 的安全规则（刻意与 dsh 自己的 `ensureSymlink` 对齐）：

- 只对「目标已经是指向本仓 `packages/` 的 symlink，或该路径上的悬空 symlink」做 `unlink` + 重建。
- 遇到真实目录 / 真实文件 / 指向 pnpm store 等外部位置的活 symlink：**报错退出，绝不 `rm -rf`。**

### 3.4 只构建了 host 半区，忘了 client → 缺 chunk

`shared/tsdown.client.ts` 里：

- **host** 构建 `clean: true`，会先清空 `lib/`；
- **client** 构建 `clean: false`，再写出 `lib/client.js`（包进 `window.__ModuleLoader__.load({…})`）。

正常 `pnpm --filter <pkg> build` 会跑 **host + client 两份** tsdown 配置。如果只跑了 host（或 host 的 `clean` 在 client 写完之后又跑了一次），`lib/client.js` 会消失。

症状：

- host 路由还在（例如 `GET /friend/pet` 仍 200）；
- 浏览器 Network 里 client 模块 404，或控制台没有 `__ModuleLoader__` 对应 id；
- UI 空白 / 设置卡不出现，但服务端日志看起来「插件已经 apply 了」。

排查：

```bash
# 有 client 半区的包，这两个文件都应该在
ls packages/dsh-friend-stage/lib/index.js
ls packages/dsh-friend-stage/lib/client.js

# 没有 client 半区的包（目前：all、perception）只有 index.js，属正常
ls packages/dsh-friend-all/lib/index.js
```

修复：对缺 chunk 的包再跑一次完整 `pnpm --filter @wish233/dsh-friend-<name> build`，然后**硬刷新**浏览器。

### 3.5 `pixi-live2d-display@0.4.0` 在 macOS 上解包成空壳

**症状**

- `packages/dsh-friend-stage/node_modules/pixi-live2d-display`（或 pnpm virtual store 里对应目录）只有空文件夹，没有 `package.json` / `dist/`。
- `pnpm --filter @wish233/dsh-friend-stage build` **不报错**，但 `lib/pet.iife.js` 变成半成品：Live2D 渲染整体失效。
- `packages/dsh-friend-stage/test/pet-iife-guard.test.ts` 在 **IIFE 已经降级** 时会红（断言 `pixi-live2d-display` 被打进 bundle）。只挪掉依赖的 `dist`、不重编 IIFE 时，这份守卫仍看旧产物，所以不会红。
- `node scripts/check-pixi-live2d.mjs` 与 `packages/dsh-friend-stage/test/pixi-live2d-unpack-guard.test.ts` 在依赖空壳时**立刻红**，不依赖是否重编。

**根因**

`pixi-live2d-display@0.4.0` 的 npm tarball 里目录缺执行位，Unix 上无法 `chdir` 进去：

| 路径 | 实测 mode |
|---|---|
| `package/cubism` | `drwxr--r--`（others/group 无 `x`；部分解包器还会把 owner `x` 丢掉） |
| `package/cubism/.vscode` | `drw-r--r--`（**连 owner 都没有 `x`**） |

macOS 上 pnpm 按 tar 权限解包时，写 `package.json` / `dist` 会 `EACCES`，该包留成空壳（只有目录，没有 `dist` / `package.json`），于是 `lib/pet.iife.js` **静默降级**、Live2D 整体失效。同一权限问题会让 `rm -rf` 也失败——先给那几个目录 `chmod u+x` 才能删。

`packages/dsh-friend-stage/vendor-integrity.json` **不是**这套机制——它只记官方 Live2D 下载（Hiyori zip / Cubism SDK / Core）的 sha256，不管 npm 解包。

**不要**把 `pixi-live2d-display` 的产物 vendored 进 git。仓库前置检查是 [`scripts/check-pixi-live2d.mjs`](../scripts/check-pixi-live2d.mjs)。

**修复**（只在临时目录操作，不要动 `~/.dsh`）

```bash
export CI=true
# 0. 若空壳已经占着路径，先补执行位再删，否则 rm -rf 会失败
DEST="$(ls -d /path/to/dsh-Friend/node_modules/.pnpm/pixi-live2d-display@0.4.0_*/node_modules/pixi-live2d-display)"
chmod u+x "$DEST" "$DEST/cubism" "$DEST/cubism/.vscode" 2>/dev/null || true
rm -rf "$DEST"

# 1. 在 os.tmpdir() 里取 tarball
cd "$(mktemp -d)"
npm pack pixi-live2d-display@0.4.0
mkdir extract
tar -xf pixi-live2d-display-0.4.0.tgz -C extract
# 2. 补上目录执行位，否则进不去
chmod u+x extract/package/cubism extract/package/cubism/.vscode
chmod -R a+X extract
# 3. 拷进本仓 pnpm virtual store（路径以本机为准）
mkdir -p "$DEST"
cp extract/package/package.json "$DEST/"
cp -R extract/package/dist "$DEST/"
# 4. 确认守卫绿，再重编 stage
cd /path/to/dsh-Friend
node scripts/check-pixi-live2d.mjs
pnpm --filter @wish233/dsh-friend-stage build
```

`pnpm build` 与 CI 会先跑 `node scripts/check-pixi-live2d.mjs`；空壳时明确失败并打印修复步骤，不会静默通过。

## 4. 验证清单：11 个插件都挂上了

1. **symlink 本身**

   ```bash
   ls -l ~/.dsh/profiles/web/node_modules/@wish233/
   ```

   应看到 11 条指向本仓 `packages/dsh-friend-*` 的 symlink，没有真实目录。

2. **启动日志**（host 半区，机器可解析）

   重启 `dsh web` 后，冒烟脚本与人工核对都认下面两类行，**不要**再找 `[@wish233/dsh-friend-shared] apply()` 这种旧格式：

   - `dsh-friend:plugin-mount <包名>` —— 每个包 host `apply()` 输出一行（helper：`packages/dsh-friend-shared/src/plugin-mount.ts`）。`<包名>` 可以是 scoped npm 名（如 `@wish233/dsh-friend-stage`）或短 id。11 个包各应出现一行。
   - `dsh-friend:preset-ready <预设 id>` —— persona 启动期 `resolve()` 成功后输出。应看到 `friend-companion` 与 `friend-companion-plus`。

   例：

   ```text
   dsh-friend:plugin-mount @wish233/dsh-friend-shared
   dsh-friend:plugin-mount @wish233/dsh-friend-persona
   dsh-friend:preset-ready friend-companion
   dsh-friend:preset-ready friend-companion-plus
   ```

   `dsh-friend-all` 是聚合 bundle；功能插件是其余 10 个。11 个 npm 包都要能从 profile 的 `node_modules` 解析到。

3. **pet 路由**（stage 已注册）

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/friend/pet
   ```

   应为 `200`（dsh web 默认端口 3080，可用 `dsh web --port <n>` 改）。

   **host 挂载行 + `GET /friend/pet` 200 不是客户端半区可用的证据。** 这三项在四个 client 半区全部崩溃、页面只剩 `Failed to load plugins` 时依然全绿。要证明客户端能加载，必须打开真实页面（下一节的长驻实例，或 `scripts/browser-smoke.mjs`）。

4. **冒烟脚本（host 侧）**

   ```bash
   export CI=true
   node scripts/smoke.mjs                 # 没有 dsh CLI 时优雅跳过，退出码 0
   node scripts/smoke.mjs --require-dsh   # CI / 本机有 dsh 时强制跑完整冒烟
   ```

   有 dsh 时默认用**隔离的临时 `DSH_HOME`**，不会改你的 `~/.dsh`。要打真实 profile 才加 `--use-user-home`。

5. **浏览器门禁（client 半区）**

   ```bash
   export CI=true
   pnpm exec playwright install chromium   # 首次；浏览器进 Playwright 缓存，不进仓库
   node scripts/browser-smoke.mjs
   node scripts/browser-smoke.mjs --require-dsh --require-browser
   ```

   断言：页面**不含** `Failed to load plugins`，且 9 个有 `dsh.client` 的包都出现在 `window.__DSH_BOOT__`（`all` / `perception` 无 client 半区）。失败信息会带上包名、未声明属性，以及 `failed to apply loader entry … cannot get property "…" without inject` 原文。

   隔离 profile 会弹「内测声明」和「添加一个 API Key 开始使用」。门禁**不**点掉它们——`Failed to load plugins` 是在这些对话框之前就渲染的整页错误态。

   `smoke.mjs` 断言完会立刻杀进程，**不能**用来点页面。要长驻实例，用下一节。

## 5. 长驻真实实例做浏览器验证

`scripts/smoke.mjs` / `scripts/browser-smoke.mjs` 都会在断言结束后杀掉 `dsh`。要自己打开 Chrome 看悬浮层、设置卡、失败页，按下面做（隔离 `DSH_HOME`，绝不碰 `~/.dsh`）：

```bash
export CI=true
export DSH_HOME="$(mktemp -d "${TMPDIR:-/tmp}/dsh-friend-live-XXXXXX")"
echo "isolated DSH_HOME=$DSH_HOME"

dsh --profile web --dump-default-config
node scripts/link-profile.mjs --profile web

node --input-type=module -e \
  "import { renderFriendOverlayPatch } from './scripts/smoke.mjs'; process.stdout.write(renderFriendOverlayPatch())" \
  > "$DSH_HOME/friend-live.patch.yml"

PORT="$(node --input-type=module -e \
  "import { pickFreePort } from './scripts/smoke.mjs'; console.log(await pickFreePort())")"
echo "open http://127.0.0.1:$PORT"

dsh web --patch "$DSH_HOME/friend-live.patch.yml" --port "$PORT"
```

`link-profile` 认 `$DSH_HOME`。overlay 由 `renderFriendOverlayPatch()` 写出，把 11 个包插进插件清单。本机若已有实例占着 3099，`pickFreePort` 会另选空闲端口。

看完后停掉该 `dsh` 进程即可；临时目录可 `rm -rf "$DSH_HOME"`。

## 6. 相关命令速查

```bash
export CI=true
pnpm test
pnpm typecheck
node scripts/aggregate.mjs --check
node scripts/release-scan.mjs --pack
node scripts/check-pixi-live2d.mjs
node scripts/smoke.mjs
node scripts/browser-smoke.mjs
node scripts/link-profile.mjs --dry-run
node scripts/link-profile.mjs --unlink
```

`release-scan` 按 **tarball 文件名** 拒绝 Cubism Core / `.moc3` / `.model3.json`，不会因为 `lib/pet.iife.js` 里出现 `Live2DCubismCore` 误报。发布、secrets、已知限制见仓库根 README 与 [release.md](release.md)。
