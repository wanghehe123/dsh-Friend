# 素材与运行时授权台账

对应迁移计划 §11、W-M8-6。本文件只记账，不把专有文件放进仓库或 npm 包。

| 资产 | 许可 | 分发 | 状态 |
|---|---|---|---|
| Kokoro Engine 逻辑（衍生） | MIT，© 2026 chyinan | 源码；根 `LICENSE` 保留原版权行 | 已落根 `LICENSE` + README 声明 |
| Live2D Cubism Core `live2dcubismcore.min.js` | Live2D 专有 | **不得**进 git / npm / 壳安装包。用户同意条款后，host 下载到本机 `vendor/cubism-core/` | **负责人已接受官方许可**（2026-08-14）。下载仍只发生在本机 pet 页「下载并启用 Live2D」，不进仓库 |
| Cubism Web Framework（经 pixi-live2d-display 内嵌） | Live2D Open Software License | 随 `lib/pet.iife.js` 构建进去，不是独立文件 | 已写入 `packages/dsh-friend-stage/THIRD-PARTY-NOTICES.md` |
| PixiJS 6.5.10 | MIT | 打进 pet IIFE | 同上 |
| pixi-live2d-display 0.4.0 | MIT | 打进 pet IIFE | 同上 |
| fflate 0.8.3 | MIT | stage **运行时**依赖（解压官方 zip），不进 IIFE | 已在 stage `THIRD-PARTY-NOTICES.md` |
| Hiyori Momose FREE 样例 | Live2D Free Material License；NOTICE 须随行；不得改角色设计 | **不得**进包。与 Core 一并下载到本机 `vendor/` | **负责人已接受样例素材许可**（2026-08-14）。下载器负责取 NOTICE；仓库 / tarball 不得出现 `.moc3` / `.model3.json` |
| 奶龙 Live2D（`models/naiwa-live2d/naiwa-live2d-v3-sdk4.2-runtime.zip`） | 一作整理自 [Diyeego/naiwa-pet](https://github.com/Diyeego/naiwa-pet/)；Cubism 4.2 runtime（moc v4） | **可进 git**，作为源码安装的内置模型。host 首次挂载解压到本机 `vendor/nailong/`。**不得**进 npm tarball（`files` 不含 zip；扫描仍禁 `.moc3` / `.model3.json` 散文件） | 产品名「奶龙」；保留上游署名 |
| 台词库 / 提示词 | 自撰或改写自旧仓（MIT） | 源码 | 无第三方素材义务 |
| `ws` 8.21.3（Edge TTS） | MIT | tts **运行时**依赖 | 已有 `packages/dsh-friend-tts/THIRD-PARTY-NOTICES.md` |

## 发布物扫描

判据是**文件名**，不是文件内容：

- 禁止：`live2dcubismcore.min.js` / `live2dcubismcore.js` / `*.moc3` / `*.model3.json` / `*.moc`
- 允许：JS 里出现全局名 `Live2DCubismCore`（`lib/pet.iife.js` 会这样写）

脚本：`node scripts/release-scan.mjs --pack`。

## 包元数据

- 11 个 `@wish233/dsh-friend-*` 均声明 `license: MIT`、`publishConfig.access: public`，已去掉 `private`。
- `dsh-friend-tts` 的 `ws@8.21.3` 声明在包内 `THIRD-PARTY-NOTICES.md`。
- 其余功能包运行时只依赖 workspace 包；stage 的 fflate / Pixi / Framework / Core 已在其 NOTICE 里。
