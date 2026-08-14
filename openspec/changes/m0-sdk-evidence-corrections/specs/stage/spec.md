## MODIFIED Requirements

### Requirement: 合规资产下载
系统 SHALL 不在 npm 包内嵌 Live2D Cubism Core 与示例模型；首次启用形象时从官方源下载 Cubism Core 与占位模型（Hiyori）及其 NOTICE 到 `vendor/`，经 sha256 校验后落盘，进度经 SSE 推送，失败可重试；静态服务以 `kind: 'prefix'` 注册于 `/friend/assets`，SHALL 防路径穿越，并 SHALL 自行校验 HTTP method（rc.6 路由不按 method 分流）。

#### Scenario: 首启下载
- **GIVEN** 全新数据目录
- **WHEN** 用户首次启用形象
- **THEN** 进度条完成后模型出现，`vendor/` 含 NOTICE 文件

#### Scenario: 发布物零内嵌
- **WHEN** 审计已发布 npm tarball
- **THEN** 不含 live2dcubismcore 与任何 Hiyori 素材文件

#### Scenario: 静态服务边界
- **WHEN** 请求 `/friend/assets/../../etc/passwd` 或以非 GET method 请求资产
- **THEN** 分别返回 403 与 405，且不读取数据目录之外的文件
