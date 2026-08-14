## MODIFIED Requirements

### Requirement: 设置父卡片
系统 SHALL 通过官方 `settings.section` 槽位（rc.6 设置域为每功能一页的 list 槽；`settings.plugin.item` 在 rc.6 不存在）注册 dsh-Friend 设置页（staged 表单）：总开关、悬浮层开关、音量/静音、当前角色下拉、配置中心入口；总开关关闭 SHALL 停用悬浮层与全部反应（不再有任何舞台指令流出）。可选再用 `settings.general.item` 在通用区放一颗跳转按钮。

#### Scenario: 总开关全停
- **WHEN** 关闭总开关
- **THEN** 悬浮层消失且工作反应与 SSE 舞台指令停止；重新开启后恢复

#### Scenario: 槽位有效
- **WHEN** 插件挂载并打开 dsh 设置面板
- **THEN** dsh-Friend 出现在设置分区导航中，且注册未因未知槽位名失败

### Requirement: 配置中心十分区
系统 SHALL 以**自建全屏覆盖层**提供配置中心（rc.6 无整页/路由级 client 槽位；`root` 为 AppFrame 独占且官方禁止注册）：左侧导航十分区（模型/人设/语音合成/语音输入/形象/记忆/成长/工作陪伴/悬浮与桌面/数据与关于），分区懒加载，路由状态经 hash 可分享可恢复，关闭后返回设置页。覆盖层 SHALL 不注册进 `root` 槽位。

#### Scenario: 分区可达与恢复
- **WHEN** 依次打开十个分区
- **THEN** 全部正常渲染无报错；在任一分区刷新页面后仍停留在该分区

#### Scenario: 不劫持应用外壳
- **WHEN** 配置中心关闭
- **THEN** dsh 会话界面完整可用，未被覆盖层遮挡或替换

### Requirement: 国际化
系统 SHALL 内置 zh（默认）与 en 资源，语言取自 `friend-core` 设置命名空间的 `language` 字段（默认系统语言）；zh/en 键集合 SHALL 相等（CI 校验），缺键回退 zh。所有设置命名空间 SHALL 匹配 `/^[a-z][a-z0-9-]*$/`（rc.6 `settingsNamespace()` 的约束，带点号的名字会抛错）。

#### Scenario: 英文界面无残留
- **WHEN** 切换语言为 en
- **THEN** 卡片与配置中心界面无中文残留

#### Scenario: 命名空间合法
- **WHEN** 校验全部 friend 设置命名空间常量
- **THEN** 每个都匹配 `/^[a-z][a-z0-9-]*$/`，无带点号者
