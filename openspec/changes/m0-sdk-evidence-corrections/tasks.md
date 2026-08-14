# 任务

## 1. 命名空间（对应 W-M8-3、及全部含配置项的工作项）
- [x] 1.1 compat 导出 kebab 命名空间常量表，功能包只能引用常量
  - 验收：`friend-core`/`friend-persona`/`friend-memory`/`friend-tts`/`friend-asr`/`friend-stage`/`friend-growth`/`friend-reactions`/`friend-pet` 全部匹配 `/^[a-z][a-z0-9-]*$/`，单测覆盖
- [x] 1.2 `bindSettingsHost` 内部经 `settingsNamespace()` 校验后再注册
  - 验收：传入带点号名字时抛错，单测覆盖
- [ ] 1.3 M1 起各功能包接入设置时一律引用常量
  - 验收：`rg "friend\.[a-z]+\."` 在 `packages/*/src` 无命中

## 2. 设置槽位与配置中心（W-M8-1、W-M8-2）
- [ ] 2.1 父卡片改挂 `settings.section`
  - 验收：dsh 设置面板出现 dsh-Friend 页，注册无未知槽位错误
- [ ] 2.2 配置中心实现为自建全屏覆盖层 + hash 路由
  - 验收：十分区可达、刷新保持分区、关闭后会话界面完整；代码中无对 `root` 槽位的注册

## 3. 路由形态（W-M2-5、W-M4-2、W-M4-3）
- [ ] 3.1 TTS 音频改 `prefix: /friend/tts/audio` + handler 解析 id
  - 验收：已知 id 200、未知 404、非 GET 405
- [ ] 3.2 资产静态服务与模型上传显式校验 method 与路径穿越
  - 验收：穿越请求 403、非法 method 405

## 4. 预设投放（W-M1-4）
- [ ] 4.1 persona 包随包投放 `presets/friend-companion{,-plus}/agent.cordis.yml`，并接入 roots
  - 验收：`resolve(id)` 成功且未 broken
- [ ] 4.2 白名单在预设常驻 scope 上 `restrict`；启动期断言失败即 fail-loud
  - 验收：伴侣会话工具集合等于白名单；预设缺失时启动报可读错误

## 5. 产物与推送契约（W-M0-5、distribution）
- [x] 5.1 client 半区产出 `__ModuleLoader__` CJS 包装，host 保持 ESM
  - 验收：9 个含 client 的包 `lib/client.js` 均以 `window.__ModuleLoader__.load({` 开头且 id 正确；产物守卫测试常驻
- [x] 5.2 `pushToClient` 走自建 SSE `/friend/events`，卸载关闭全部连接
  - 验收：单测覆盖 405、广播、心跳、dispose

> 已勾选项为 M0 实施中已完成并经验收者复跑确认；未勾选项在对应里程碑落地。
