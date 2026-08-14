# @wish233/dsh-friend-settings

设置父卡片、配置中心覆盖层（十分区）与数据/关于。

rc.6 没有整页/路由级 client 槽位。本包：

- 在官方 `settings.section` 注册 dsh-Friend 父卡片（可选再挂 `settings.general.item`）
- 用自建全屏覆盖层做配置中心，hash 为 `#/friend/config/<section>`
- 聚合各功能包设置；密文只留在 host，client 投影只有 `hasApiKey`

## 验证

1. `dsh web` 打开设置 → 导航里出现 **dsh-Friend**。
2. 关总开关后，卡片里悬浮层/音量/角色控件禁用。
3. 点「打开配置中心」→ 十分区都能点开；刷新后 hash 仍停在当前分区。
4. 切界面语言为 en，卡片与覆盖层无中文残留。
5. 「数据与关于」可导出 zip（不含 `cache/`、`vendor/`）。
6. 浏览器 DevTools 看 `/friend/settings/snapshot`，响应里不能出现 API key。
