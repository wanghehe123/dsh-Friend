## MODIFIED Requirements

### Requirement: 许可合规
仓库 SHALL 保留上游 MIT 版权声明（`Copyright (c) 2026 chyinan`）并在 README 声明衍生关系；SHALL 维护 `docs/assets-compliance.md`（Hiyori/Cubism/鲸鱼娘授权台账）与 `THIRD-PARTY-NOTICES.md`；npm 发布物 SHALL 不含 Live2D 专有**文件**。CI 断言 SHALL **按文件**扫描（不得存在 `.moc3` / `.model3.json` / `live2dcubismcore.min.js` 等）；SHALL NOT 用 tarball 全文 `rg live2dcubismcore` 作为判据——打包后的 JS 合法引用全局名 `Live2DCubismCore` 会误报。

#### Scenario: 合规审计
- **WHEN** 逐项核对迁移计划 §11 合规表
- **THEN** 每行都有对应落地物（文件或 CI 检查）

#### Scenario: tarball 按文件扫描
- **WHEN** CI 检查发布 tarball 的文件列表
- **THEN** 不存在上述专有文件；不得仅因源码出现 `Live2DCubismCore` 字符串而失败

## ADDED Requirements

### Requirement: 启动可观测标记
每个功能包 host `apply()` SHALL 输出一行 `dsh-friend:plugin-mount <包名>`（helper：`packages/dsh-friend-shared/src/plugin-mount.ts`）。persona 在预设 `resolve()` 成功后另输出 `dsh-friend:preset-ready <预设 id>`。冒烟脚本 SHALL 以这两类行判断挂载与预设可用。标记格式 SHALL 稳定；更换发射方式只改 helper，不改各包的 `logPluginMount(name)` 调用点。

#### Scenario: 冒烟可 grep 挂载
- **WHEN** 隔离环境启动 `dsh web` 并加载本套件
- **THEN** 日志对每个包出现 `dsh-friend:plugin-mount` 行，且含 persona 的 `dsh-friend:preset-ready` 行

### Requirement: Cordis inject 硬性声明
凡 host 半区访问 `ctx.<service>` 的插件，SHALL 在模块级导出 `export const inject = [...]` 列出将读取的服务名。Cordis 代理在读取属性（包括与 `undefined` 比较）时，若未 inject 即抛 `cannot get property "<name>" without inject` 并导致整个插件树挂载失败。
证据：实现过程两次真实冒烟失败——persona 的 `agentPresets` 与 tts 的 `webServer`。现状：persona `['agentPresets','systemPrompt','tools']`、tts `['webServer']`、stage `['webServer','tools']`。本条须在归档后补进 `docs/m0-findings.md`（本 change 文件边界本轮不改该文件）。

#### Scenario: 未 inject 即读属性失败
- **WHEN** 模块未声明某服务却读取 `ctx` 上该属性
- **THEN** 抛错且插件树不能完成挂载

### Requirement: shared 三出口与包边界
`@wish233/dsh-friend-shared` SHALL 提供三个不可混用的出口：

- `.`：host 半区裸 ESM，含 Node 专用代码，**禁止**进入 client 半区；
- `./universal`：平台中立裸 ESM，只放纯常量/纯函数，**禁止** `node:` 与浏览器全局；client 构建必须将其**内联**（它不在 `shared/web-platform.ts` 平台种子表里；若被 external，运行时抛 `require missed the module table`）；
- `./client`：`window.__ModuleLoader__.load(...)` 包装产物，**只**给 dsh web loader；Node / vitest / 打包器 SHALL NOT 当普通 ESM 引入。

`packages/*/src` 与 `packages/*/test` SHALL NOT 使用逃出自身包目录的相对 import，必须走包名 subpath。守卫测试：`shared/package-boundary.test.ts`。

#### Scenario: 出口用途守卫
- **WHEN** 运行包边界与 universal/client 入口测试
- **THEN** 跨包相对路径为 0；universal 图中无 `node:` / 浏览器全局；client 产物为 ModuleLoader 包装而 universal 为裸 ESM

#### Scenario: universal 必须被 client 内联
- **WHEN** 构建任一功能包 client 半区
- **THEN** `@wish233/dsh-friend-shared/universal` 被打进该包 factory，而不是 `require` 外部模块表

### Requirement: 工具定义使用 ParameterSchemaSpec
经 compat 注册的伴侣工具 SHALL 使用 rc.6 `defineTool` 的 `parameters: ParameterSchemaSpec`（隐式 object 的属性表，每项 `{ type, enum?, required?, description? }`，编译成 JSON Schema），SHALL NOT 把 zod schema 或 schemastery `Schema` 传给 `defineTool`。`output.schema` 与 `output.render` SHALL 必填。
证据：`@deepseek-ai/dsh-tools/lib/types/schema.d.ts`；该包运行时依赖 `@deepseek-ai/schemastery`，但 schemastery 只给 settings 用，`defineTool` 不消费它。

#### Scenario: 表演工具符合 DSL
- **WHEN** 检查 `set_expression` 等已注册工具定义
- **THEN** parameters 为带 type/enum/required 的属性表，且声明了 output.schema 与 output.render
