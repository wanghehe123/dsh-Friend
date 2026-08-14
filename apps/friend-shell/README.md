# friend-shell

Tauri 2 薄壳：透明置顶窗、全局快捷键、托盘、自启、点击穿透、连接引导。业务（渲染 / ASR / TTS / 记忆）都在 dsh 的 `/friend/pet` 页，壳不重写。

## 运行

本机需要已安装 Rust，以及一台能响应 `GET /friend/pet` 的 dsh（默认 `http://127.0.0.1:3080`）。

```bash
cd apps/friend-shell
cargo run
```

未启动 dsh 时会显示本地引导页（复制 `npx @deepseek-ai/dsh web`、重试、可选由壳代启动）。dsh 起来后 ≤ 5 s 自动切入 pet 页。

探测到 dsh 可达后，壳每 **20 秒** `POST /friend/shell/heartbeat`，JSON 只有 `{ version, platform, pid }`。选 20 s 是因为配置中心 90 s 无心跳即离线：20 落在契约的 15–30 s 里，连续错过 4 拍（80 s）仍显示在线，第 5 拍才出窗，能扛一次短卡顿又不会把「已连接」撒谎到数分钟。dsh 不可达时不打 POST、不刷错误日志；POST 失败只打一行然后指数退避（2 s → 30 s 封顶）。托盘退出会置位停止旗，心跳线程在 200 ms 节拍内退出。

打包（本轮 CI 配置了 tag 触发；本地完整 `tauri build` 需要签名环境，不是日常必跑）：

```bash
cargo install tauri-cli --locked --version 2.11.4
cargo tauri build --bundles dmg   # macOS
cargo tauri build --bundles msi   # Windows
```

发布物**不含** Live2D 素材或 Cubism Core。

## `shell-config.json`

与 friend 数据目录同树、独立文件，**不是** host `friend-pet` settings 文档。

| 优先级 | 路径 |
|---|---|
| 1 | `$FRIEND_SHELL_CONFIG_PATH`（完整文件路径） |
| 2 | `$FRIEND_DATA_DIR/shell-config.json` |
| 3 | `$DSH_HOME/friend/shell-config.json` |
| 4 | `<homedir>/.dsh/friend/shell-config.json` |

写入是原子的：先写同目录临时文件并 `fsync`，再把旧文件改名为 `shell-config.json.bak`，最后把临时文件改名为正式文件。解析失败**不会**覆盖原文件；主文件缺失时读 `.bak`。

字段语义沿 Kokoro `pet_config.json`：

| 字段 | 含义 |
|---|---|
| `enabled` | 窗口是否显示（重启复原） |
| `position_x` / `position_y` | **物理像素**（旧 `PhysicalPosition`） |
| `window_width` / `window_height` | **逻辑像素**（旧 `LogicalSize`）；`< 100` 回退 400×600 |
| `shortcut` | 显隐，默认 `CmdOrCtrl+Shift+Space` |
| `model_url` / `model_scale` / `render_fps` | 只持久化，供导入/设置中心；壳不渲染 |
| `base_url` | 默认 `http://127.0.0.1:3080` |
| `skip_taskbar` / `always_on_top` | 默认开 |
| `click_through` | 点击穿透，默认关 |
| `autostart` | 开机自启，默认关 |
| `spawn_dsh` | 由壳代启 dsh，默认关 |
| `talk_shortcut` | 按住说话，默认 `CmdOrCtrl+Shift+M` |
| `talk_mode` | `hold`（默认）或 `toggle` |
| `muted` | 托盘静音 |

未知字段经 `extra` 原样写回，避免新版本或设置中心加键后被壳存盘丢掉。

## 全局快捷键如何进 pet 页

1. `tauri-plugin-global-shortcut` 收到 Pressed / Released。
2. 壳对 pet webview `eval`：`window.__DSH_FRIEND_SHELL__.talk('pressed'|'released', mode)`。
3. 注入脚本依次：
   - 派发 `dsh-friend:shell-talk`
   - 若存在 `window.__DSH_FRIEND_ASR__.session.dispatch`，送 `hotkey-down` / `hotkey-up`（W-M3-2 状态机）
   - 否则点 pet 页自带的 `#friend-voice`（当前 stage 内联 Web Speech）
   - 都没有则一次性弹出 endpoint 配置指引

WebView User-Agent 含 `dsh-friend-shell` / `Tauri` / `FriendShell`，与 `dsh-friend-asr` 的桌面壳探测一致。

## 点击穿透

开启 `click_through` 后，壳每 ~32 ms 把全局光标换算成窗口坐标，`eval` `probeHit`。页面用 `__DSH_FRIEND_PET__.hitTest` 和 DOM chrome（气泡/按钮/引导卡）决定是否 `invoke('set_cursor_ignore')`，壳再 `setIgnoreCursorEvents`。

## 手册验证（本轮自动化未覆盖）

- macOS 置顶于全屏外应用、背景透明无白底
- 拖拽 / 八向缩放后重启，位置尺寸误差 0
- 先开壳后开 dsh，引导页自动切 pet
- IDE 前台：`Cmd+Shift+Space` 显隐、`Cmd+Shift+M` 按住说话
- 托盘四项；开自启后注销重登
- 穿透开：点模型旁空白落到下层窗口；右键模型仍出菜单
- 托盘退出后 `ps` 无 friend-shell / 代启 dsh 残留
- 完整 `tauri build` 出 dmg/msi（需签名环境）

## 依赖许可证（直接依赖）

| crate | 版本 | 许可 |
|---|---|---|
| tauri / tauri-build | 2.11.5 / 2.6.3 | MIT OR Apache-2.0 |
| tauri-plugin-global-shortcut | 2.3.2 | MIT OR Apache-2.0 |
| tauri-plugin-autostart | 2.5.1 | MIT OR Apache-2.0 |
| tauri-plugin-opener | 2.5.4 | MIT OR Apache-2.0 |
| serde / serde_json | 1.0.229 / 1.0.151 | MIT OR Apache-2.0 |
| mouse_position | 0.1.4 | MIT |
| tempfile (dev) | 3.27.0 | MIT OR Apache-2.0 |
