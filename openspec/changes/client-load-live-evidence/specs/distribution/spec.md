## MODIFIED Requirements

### Requirement: Cordis inject 硬性声明
凡访问 `ctx.<service>` 的插件半区（**host 与 client 同等适用**），SHALL 在模块级导出 `export const inject = [...]` 列出将读取的服务名；client 半区 SHALL 同时在 `package.json` 的 `dsh.client.inject` 声明同一组名字。Cordis 代理在**读取属性时**（包括与 `undefined` 比较）若未 inject 即抛 `cannot get property "<name>" without inject`，并导致该半区整体加载失败。

`ctx` SHALL 只承载**真 dsh 服务**（如 `settingsScope`、`slots`、`webServer`、`agentPresets`、`tools`）与 Cordis 自身 API（`effect` 为 mixin，不必声明）。浏览器全局（`window`、`document`、`location`、`EventSource`、`speechSynthesis`）与测试注入缝（回调、播放器、音量、静音等状态值）SHALL 通过显式 options 参数传入，从 `globalThis` 取缺省值；SHALL NOT 从 `ctx` 上读，也 SHALL NOT 把这类非服务名塞进 `dsh.client.inject` 以绕过代理。

证据：host 侧两次真实冒烟失败（persona 的 `agentPresets`、tts 的 `webServer`）；client 侧一次真实浏览器失败——`tts`（`speechSynthesis` 等 9 个）、`asr`（`settingsScope` / `window` / `document`）、`settings`（`document` / `location`）、`reactions`（`EventSource` / `applyPerformance`）四个半区在页面上报 `Failed to load plugins`，而 `dsh-friend-stage` 因只读已声明的 `settingsScope` 正常加载。

#### Scenario: 未 inject 即读属性失败
- **WHEN** 模块未声明某服务却读取 `ctx` 上该属性
- **THEN** 抛错且该半区不能完成加载

#### Scenario: 浏览器全局不走 ctx
- **WHEN** 检查任一 client 半区入口
- **THEN** 浏览器全局与测试缝来自 options 或 `globalThis`，`ctx` 上只出现已声明的 dsh 服务与 `effect`

#### Scenario: 严格 context 下逐包可加载
- **WHEN** 用「未声明属性 getter 抛错」的严格假 context 调用每个包的 client 入口
- **THEN** 全部不抛异常

## ADDED Requirements

### Requirement: 客户端真实加载门禁
CI SHALL 包含一层浏览器级检查：在隔离 `DSH_HOME` 启动真实 `dsh web`、加载客户端页面，断言页面**不含** `Failed to load plugins` 且全部客户端半区加载成功。host 侧的 `dsh-friend:plugin-mount` / `dsh-friend:preset-ready` 行与 `GET /friend/pet` 200 SHALL NOT 被当作客户端半区可用的证据——这三项在四个半区全部崩溃时**依然全绿**。

#### Scenario: 客户端崩溃被拦住
- **WHEN** 任一 client 半区读未声明的 ctx 属性
- **THEN** 浏览器级检查失败，且失败信息指出是哪个包与哪个属性

#### Scenario: host 绿不等于客户端可用
- **WHEN** host 打印全部挂载行且 `/friend/pet` 返回 200
- **THEN** 仍须通过浏览器级检查才视为客户端半区可用

### Requirement: 包可发布性闸门
11 个包 SHALL 声明与根 `LICENSE` 一致的 `license` 字段；SHALL NOT 保留 `private: true`；scope 包 SHALL 声明 `publishConfig.access`；11 包版本 SHALL 一致。发布前检查 SHALL 对可发布性做二值判定并在 CI 可跑，SHALL NOT 依赖 `pnpm publish` 失败来发现问题。

#### Scenario: 可发布性检查
- **WHEN** 运行发布前扫描
- **THEN** 任一包缺 `license`、仍为 `private`、或版本不一致时检查失败并指出包名

### Requirement: 依赖解包完整性
构建 SHALL 有前置检查确认 `pixi-live2d-display` 的 `dist` 与 `package.json` 真实存在且非空；不满足时 SHALL 显式失败并给出修复步骤，SHALL NOT 静默产出降级的 `lib/pet.iife.js`。根因（该 tarball 内 `package/cubism` 与 `package/cubism/.vscode` 目录缺执行位，macOS 上 pnpm 解包失败留下空壳）与修复步骤 SHALL 记入 `docs/dev-loop.md`。

#### Scenario: 依赖坏掉时显式失败
- **WHEN** `pixi-live2d-display` 的 `dist` 缺失或为空
- **THEN** 前置检查失败并提示修复步骤，而不是构建出缺少 Live2D 运行时的 pet 产物
