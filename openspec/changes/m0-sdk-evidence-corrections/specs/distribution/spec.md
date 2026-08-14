## ADDED Requirements

### Requirement: client 半区加载契约
每个声明 `dsh.client` 的包，其构建产物 `lib/client.js` SHALL 是**经典脚本形态的 CJS 工厂包装**：以 `window.__ModuleLoader__.load({ id: "<完整包名>", factory: (require) => { ... } })` 注册，平台依赖以 `require(...)` 形式外置。裸 ESM 产物 SHALL 视为构建缺陷——dsh 的 `ClientModuleSystem` 用经典 `<script>` 标签加载 bundle，加载后若未经 `__ModuleLoader__.load` 注册工厂即抛错。host 半区 `lib/index.js` 则 SHALL 保持 ESM。

#### Scenario: 产物守卫
- **WHEN** 构建后检查全部含 client 半区的包
- **THEN** 每个 `lib/client.js` 以 `window.__ModuleLoader__.load({` 开头且 `id` 等于该包完整包名；对应 `lib/client.d.ts` 未被包装

#### Scenario: host 不受影响
- **WHEN** 检查任一包的 `lib/index.js`
- **THEN** 其为 ESM 且不含 loader 包装

### Requirement: 推送通道兜底
host→client 的业务事件推送 SHALL 走自建 SSE `GET /friend/events`（`kind: 'exact'`）。rc.6 的官方下行（`/api/events.mux`、`/api/events.host`、`host/remote-event`）帧类型与事件名均为封闭白名单，插件无法扩展，SHALL NOT 被占用或塞入私有事件。SSE handler SHALL 只接受 GET、维持心跳、并在插件卸载时关闭全部连接。

#### Scenario: 不占用官方通道
- **WHEN** 审计插件注册的路由与发出的事件
- **THEN** 不存在对 `/api/*` 的注册，也不依赖官方转发白名单承载 friend 事件

#### Scenario: 卸载不漏连接
- **WHEN** 插件被卸载或热重载
- **THEN** 全部已建立的 SSE 响应被关闭，无残留文件描述符
