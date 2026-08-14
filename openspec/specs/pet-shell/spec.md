# pet-shell Specification

## Purpose

桌面薄壳（apps/friend-shell，Tauri 2）：OS 级透明置顶悬浮窗加载 `/friend/pet?transparent=1`，提供全局快捷键、托盘、自启与点击穿透。壳内不含业务逻辑，全部功能由 dsh host 提供。对应迁移计划 §5.10，工作项 W-M6-*。

## Requirements

### Requirement: 悬浮窗口
壳 SHALL 创建透明、置顶、无边框、可配 skipTaskbar 的单窗口加载 pet 页；位置与尺寸 SHALL 持久化（字段语义沿旧 `pet_config.json`），重启后精确复原。

#### Scenario: 置顶与透明
- **WHEN** 壳启动且 dsh 可达
- **THEN** 角色悬浮于所有应用之上，背景透明无白底

#### Scenario: 位置复原
- **WHEN** 拖动并缩放窗口后退出重启
- **THEN** 位置与尺寸误差为 0

### Requirement: 连接探测与引导
壳 SHALL 启动时探测 dsh 可达性（超时 3 s，退避重试）：不可达时显示本地引导页（一键复制启动命令、重试、可选由壳代启 dsh——默认关闭）；恢复可达后 SHALL 在 5 s 内自动进入 pet 页。

#### Scenario: 先开壳后开 dsh
- **GIVEN** dsh 未启动时打开壳（显示引导页，不白屏不崩溃）
- **WHEN** 用户启动 `dsh web`
- **THEN** 壳在 5 s 内自动切换到形象页面

### Requirement: 全局快捷键
壳 SHALL 注册系统级快捷键：显隐（默认 `CmdOrCtrl+Shift+Space`）与按住说话（默认 `CmdOrCtrl+Shift+M`，Pressed 开始采音、Released 结束发送，亦可配为切换式）；改键 SHALL 经配置中心下发并重注册，重复注册 SHALL 不报错。

#### Scenario: 其他应用前台可用
- **GIVEN** IDE 在前台
- **WHEN** 按住 `Cmd+Shift+M` 说话后松开
- **THEN** 伴侣收到该消息并语音回复

### Requirement: 托盘与自启
壳 SHALL 提供托盘菜单（显示/隐藏、静音、打开配置中心、退出）与开机自启开关（默认关闭）；退出后 SHALL 无残留进程。

#### Scenario: 干净退出
- **WHEN** 通过托盘退出
- **THEN** 进程列表无 friend-shell 残留

### Requirement: 点击穿透
壳 SHALL 支持点击穿透开关：开启时模型外的透明区域点击落到底层窗口（命中区由 pet 页动态上报），模型本体仍可交互。

#### Scenario: 穿透与交互并存
- **GIVEN** 点击穿透开启
- **WHEN** 点击模型旁的透明区域与右键模型本体
- **THEN** 前者点到底层窗口，后者弹出模型菜单

### Requirement: 壳内语音降级
pet 页在壳内（无 Web Speech 的 WebView）SHALL 自动改用 endpoint 引擎；无可用引擎时 SHALL 给出一次性配置指引而非报错。

#### Scenario: 未配置端点的提示
- **GIVEN** 壳内且未配置 ASR 端点
- **WHEN** 用户尝试按住说话
- **THEN** 气泡显示配置指引，应用不报错

### Requirement: 打包分发
壳 SHALL 产出 macOS dmg 与 Windows msi 安装包，经 GitHub Releases 分发（tag 触发 CI 构建）；配置中心「悬浮与桌面」分区 SHALL 显示下载链接与壳在线状态（心跳）。

#### Scenario: 干净机器安装
- **WHEN** 在未装开发环境的 macOS 安装 dmg 并启动
- **THEN** 壳正常运行，配置中心显示「壳已连接」
