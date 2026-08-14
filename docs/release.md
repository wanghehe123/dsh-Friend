# 发布流水线

W-M8-6 / W-M8-8。本文件说明现有 GitHub Actions、需要配置的 secrets，以及**尚未在真实 CI 上跑过**。

## 工作流（不要互相踩）

| 文件 | 触发 | 做什么 |
|---|---|---|
| `.github/workflows/ci.yml` | `pull_request`、`push` 到 `main` | install → build → typecheck → test → `aggregate --check` → **`release-scan.mjs --pack`** → smoke（无 dsh 则跳过） |
| `.github/workflows/canary.yml` | 每周日 / `workflow_dispatch` | 用 `@deepseek-ai/*@latest` 重装后 build/test；失败开 issue。本轮**未改**步骤语义 |
| `.github/workflows/shell-release.yml` | `v*`、`shell-v*`、`workflow_dispatch` | macOS dmg + Windows msi，上传 GitHub Release。本轮**未改**触发与打包命令 |
| `.github/workflows/release.yml` | `v*`、`npm-v*`、`workflow_dispatch` | 版本一致性 → 合规扫描 →（包可发布时）`pnpm publish -r` + provenance |

`v1.2.3` 会同时打壳安装包和走 npm job，这是双发布。只要壳、不要 npm 时打 `shell-v1.2.3`。只要 npm、不要壳时打 `npm-v1.2.3`。

## npm 发布 job 在做什么

1. `CI=true`、`pnpm install --frozen-lockfile`、`pnpm -r build`、`pnpm typecheck`、`pnpm test`、`aggregate --check`。
2. `node scripts/release-scan.mjs --pack --check-versions --tag <git tag> --require-publishable`
   - `--pack`：对每个 `packages/*` 跑 `npm pack --dry-run --json`，按**文件名**拒绝 Cubism Core / `.moc3` / `.model3.json`。
   - `--check-versions`：11 包 version 必须相同，且等于 tag（`v0.1.0` / `npm-v0.1.0` → `0.1.0`）。
   - `--require-publishable`：任一包 `private: true` 或缺少 `license` 字段则失败。**今天会失败**——11 包都是 private 且无 license，这是故意的闸门，不是工作流写错。
3. `pnpm publish -r --access public --no-git-checks`，`NPM_CONFIG_PROVENANCE=true`。

没有 changesets。本轮不能改 `packages/**`，也就不能在各包落地 changeset 配置。版本对齐靠 tag + `--check-versions`。包从 private 放出、补齐 license 之后，如需 11 包联动再另加 changesets。

## 需要项目方配置的 secrets / 变量

工作流里**没有**写入真实密钥，只有 `${{ secrets.* }}` 占位。

| 名称 | 用在 | 用途 |
|---|---|---|
| `NPM_TOKEN` | `release.yml` | npm automation token，权限需能发布 `@wish233/*`（或你们最终 scope）。`setup-node` 的 `registry-url` 会把它写成 `NODE_AUTH_TOKEN` |
| `GITHUB_TOKEN` | `shell-release.yml` | Actions 自动提供，用来上传 Release；不要再塞一个写死的 PAT 进 YAML |

壳签名（`shell-release.yml` 现在是**未签名**产物，`tauri.conf.json` 里 `signingIdentity` / `certificateThumbprint` 为 null）：

| 名称 | 平台 | 何时才需要 |
|---|---|---|
| Apple Developer 证书 + 公证相关 secrets（自行决定变量名，例如 `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`） | macOS dmg | 要对用户机分发已签名 / 已公证的安装包时。未配则继续出未签名 dmg |
| Windows 代码签名证书（例如 `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD`） | msi | 要对用户机分发已签名 msi 时。未配则继续出未签名 msi |

不要把证书文件 commit 进仓库。配好之后再改 `shell-release.yml` 的签名步骤；本轮不预埋假命令去读不存在的 secret。

可选：仓库 Settings → Variables 无需为本轮 job 增加开关。发布闸门是 `--require-publishable`，不是静默跳过。

## 合规扫描怎么跑

```bash
export CI=true
node scripts/release-scan.mjs --pack
```

退出码 0 = 当前各包 tarball 文件名里没有专有素材。脚本会**打印** license / private 备注，但默认不因此失败（那是 `--require-publishable` 的事）。

本地核对 tarball 实体（与 CI 的 dry-run 文件集相同）：

```bash
export CI=true
mkdir -p /tmp/dsh-friend-pack
pnpm --filter @wish233/dsh-friend-stage pack --pack-destination /tmp/dsh-friend-pack
tar -tzf /tmp/dsh-friend-pack/wish233-dsh-friend-stage-0.1.0.tgz
```

## 尚未验证

- 本轮新增 / 修改的 workflow **没有**在 GitHub Actions 上跑过。本地可用 `actionlint`（若已安装）看 YAML；未安装则只做人工对照。
- `pnpm publish` **没有**对 Verdaccio / 真实 npm 做过 dry-run（包仍是 private，publish 会被跳过或被闸门拦住）。
- `dsh plugin add github:<owner>/dsh-Friend` 干净环境全流程 **未做**。
- 壳 dmg/msi 构建 **未在本轮 CI 跑**（`shell-release.yml` 原样保留）。
