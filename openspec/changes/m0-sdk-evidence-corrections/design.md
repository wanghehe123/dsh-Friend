# 设计说明：为什么按这五条改

## 证据方法

结论一律来自本机安装物，不采信记忆或上游文档转述：

- SDK 类型与实现：`node_modules/@deepseek-ai/*@0.1.0-rc.6`（含 `.pnpm/` 下的传递依赖）
- dsh CLI 自带的 client loader：`@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules`
- 运行时验证：`scripts/smoke.mjs` 以隔离 `DSH_HOME` 起真实 `dsh web`，11 个插件挂载、`GET /friend/pet` 返回 200

完整引证见 `docs/m0-findings.md`（每条带 `文件:行号`）。

## 逐条取舍

### 1. 命名空间去点号
`settingsNamespace()` 硬校验 `/^[a-z][a-z0-9-]*$/`。可选做法有二：把配置全塞进一个 `friend` 空间用嵌套字段，或每个功能域一个 kebab 空间。选后者——与包边界对齐，`installSettingsSection` 按空间注册/监听，域内改动不会互相触发重渲染。空间常量集中在 compat 导出，功能包禁止手写字符串，配套一条正则测试防回潮。

### 2/3. 槽位与配置中心
`settings.section` 是官方「每功能一页」的 list 槽，父卡片放这里最省事且符合用户心智。整页配置中心没有官方座位：`root` 被 AppFrame 独占且注释明令禁止注册，`shell.overlay` 的声明包 `dsh-client-ui-layout` 不在安装树里。因此自建覆盖层，但**限定它不进任何官方 single 槽**，将来若 `shell.overlay` 可用，只需把同一组件迁进 list 槽，十分区实现不动。

### 4. 路由无 `:param`
`WebRoute` 只有 `exact` / `prefix`，且不按 method 分流。凡带路径参数的接口一律 `prefix` + handler 内解析；凡对外接口一律显式校验 method。这条对 TTS 音频、资产静态服务、模型上传都适用，因此在 spec 里写成通用要求而不是逐个接口的特例。

### 5. 预设是目录
rc.6 的 `AgentPresets` 只有 list/resolve/mount/composeFrom/read/copy/remove，没有 register，且创作面只接受「整目录复制」，不接受组装文本。所以「注册预设」在本项目里的真实含义是：随包投放 `presets/<id>/agent.cordis.yml` + 让发现器扫到 + 启动期 `resolve` 断言。

这条的隐蔽风险最高：若退而求其次在 host 全局注册伴侣工具与人格分区，编码会话会被污染；若在全局 `restrict`，SDK 直接抛错。spec 因此把「fail-loud」写成可测场景，避免实现悄悄退化成全局注册。

## 未纳入本次的观察

- MCP：安装树里没有 `dsh-mcp*` 包，time 工具接线待 M8 前再定（官方 MCP 或 `defineTool` 自实现），不影响现有 spec。
- `immediately` 字段：官方 `dsh.client` 有此可选项，语义未完全摸清，暂不写进 spec。
