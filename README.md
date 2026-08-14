# dsh-Friend · DeepSeek Harness 人格化伴侣

dsh-Friend 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的人格化伴侣插件：人设卡、语音对话、Live2D 舞台、本机记忆、成长故事、工作陪伴。挂在现有 `dsh web` 上，一条命令装齐。

衍生自 [Kokoro Engine](https://github.com/chyinan/Kokoro-Engine)（MIT, © 2026 chyinan）。

![dsh-Friend 主界面](docs/screenshots/01-hero-main.png)

## Live2D 舞台

打开 `/friend/pet`，或看 `dsh web` 右下角的悬浮层。配置中心 → 形象 → 当前 Live2D 切换模型。

源码或 npm 安装后自带 **奶龙**（Cubism 4.2 / moc v4）。官方 **Hiyori** 要在本机同意条款后下载，不进仓库。也可以导入自己的 Cubism zip（需含 `model3.json`，上限 200 MB）。

表情按钮：平静、笑、尴尬、难过、惊讶、困倦、生气。回复里的 `[expr:smile]` 会驱动形象，不会出现在悬浮气泡和朗读里。

| 独立舞台 | 形象选择 |
| --- | --- |
| ![Live2D 舞台](docs/screenshots/02-live2d-pet.png) | ![形象设置](docs/screenshots/04-config-stage.png) |

> Cubism 5.3（moc v5+）目前画不出来，请用 SDK 4.2 导出。奶龙已是 moc v4。

奶龙 runtime 在仓库 `models/naiwa-live2d/naiwa-live2d-v3-sdk4.2-runtime.zip`，首次挂载解压到本机 `vendor/nailong/`。素材整理自 [Diyeego/naiwa-pet](https://github.com/Diyeego/naiwa-pet/)。官方 Cubism Core 与 Hiyori FREE 的下载约定见 [docs/assets-compliance.md](docs/assets-compliance.md)。

## 人设

配置中心「人设」改名字、称呼、性格、背景、说话风格。Live2D 不在这张卡上选，统一走「形象」。支持多角色和酒馆卡导入。

![人设](docs/screenshots/03-config-persona.png)

## 语音合成

配置中心「语音合成」选引擎、试听、调语速和自动朗读。

| 引擎 | 说明 |
| --- | --- |
| Edge | 不用 key，晓晓 / 云希等 |
| 百炼 | 阿里云 Qwen-TTS / CosyVoice（`dashscope`） |
| MiniMax | 官方 `t2a_v2` |
| OpenAI 兼容 | 实现了 `/audio/speech` 的网关 |
| 浏览器 | `speechSynthesis` |

舞台指示默认不朗读。API key 只存在 host settings。

![语音合成](docs/screenshots/05-config-tts.png)

## 语音输入

配置中心「语音输入」：

- 引擎：Chrome Web Speech，或自定义 ASR 端点
- 模式：按住说话、开关切换、自动监听
- 识别完可自动发给伴侣；打开「说话时打断朗读」后，开口会停掉当前 TTS

![语音输入](docs/screenshots/07-config-asr.png)

> Safari 没有可用的 Web Speech，请配自定义 ASR 端点。

## 记忆与成长

记忆写在本机 Markdown：`MEMORY.md`、`memory/YYYY-MM-DD.md`、`USER.md`。可以空闲自动小结，按钟点蒸馏到长期记忆。

成长是三步向导：基础设定 → 模拟人生 → 草稿审核后再写入记忆。也可以单独打开 `/friend/growth`。

![成长向导](docs/screenshots/08-config-growth.png)

## 工作陪伴

只看会话事件的类型、时长和成败，不读文件内容和用户正文。档位：仅动作、动作 + 气泡、再加语音。可设安静时段和冷却。

「悬浮与桌面」能弹出独立窗口（Document PiP 或 `window.open`）。可选薄壳：

```sh
cd apps/friend-shell && cargo run
```

dsh 没起来时显示引导页，起来后切到 `/friend/pet`。

## 设置

设置 → **dsh-Friend** 是总开关。「打开配置中心」进入分区小窗，地址是 `#/friend/config/<section>`，刷新还停在当前分区。

![设置卡片](docs/screenshots/06-settings-card.png)

| 分区 | 内容 |
| --- | --- |
| 模型 | 对话 / 小结 / 成长，可继承 dsh 当前模型 |
| 人设 | 角色卡 |
| 语音合成 | TTS 引擎与试听 |
| 语音输入 | ASR 引擎、模式、快捷键 |
| 形象 | 当前 Live2D、导入 zip、帧率 |
| 记忆 | 开关、小结、蒸馏时刻 |
| 成长 | 三步向导 |
| 工作陪伴 | 反应档位与冷却 |
| 悬浮与桌面 | 位置、弹出、壳心跳 |
| 数据与关于 | 导出 zip（不含 `cache/`、`vendor/`） |

## 安装

DSH 插件通过 `dsh plugin` 装进 **profile**（`dsh web` 对应 `web`）。推荐装聚合包 `@wishp3/dsh-friend-all`，一个包装齐全部子包。

### 方式一：从 npm 安装（推荐）

插件已发布到 npm（`@wishp3` scope）：

```sh
dsh plugin --profile web add @wishp3/dsh-friend-all@0.1.0
```

装完重启 `dsh web`。

> 版本钉在当前发布版 `0.1.0`。升级时把 `@0.1.0` 换成新版本号。
>
> 如果这个 profile 以前跑过 `link-profile`，先把 `~/.dsh/profiles/web/cordis.patch.yml` 恢复成 `[]`，再装 npm 包。两套清单叠在一起会报 `duplicate loader entry id: dsh-friend-asr`。

### 方式二：从 GitHub 仓库安装（改代码调试）

包已经在 npm 上，仓库安装只给本地改代码用（需要 Node.js >= 22 与 pnpm）。本机 pnpm 11 没有 TTY 时会退出，先：

```sh
export CI=true
```

```sh
# 1. 克隆仓库
git clone https://github.com/wanghehe123/dsh-Friend.git
cd dsh-Friend

# 2. 安装依赖并构建
pnpm install
pnpm -r build

# 3. 把全家桶链接进 web profile
node scripts/link-profile.mjs
dsh plugin --profile web add link:$(pwd)/packages/dsh-friend-all

# 4. 重启 dsh web
dsh web
```

> profile 目录不是 pnpm workspace，聚合包里的 `workspace:*` 会回退拉 npm。
> 改本地代码必须先跑 `node scripts/link-profile.mjs`，否则改的是已发布包，不是这份仓库的 `lib/`。

逐步说明见 [docs/dev-loop.md](docs/dev-loop.md)。

### 单独安装某个插件

不想装全家桶时，可以按包名单独装：

```sh
dsh plugin --profile web add @wishp3/dsh-friend-stage      # Live2D 舞台
dsh plugin --profile web add @wishp3/dsh-friend-persona    # 人设
dsh plugin --profile web add @wishp3/dsh-friend-tts        # 语音合成
dsh plugin --profile web add @wishp3/dsh-friend-asr        # 语音输入
dsh plugin --profile web add @wishp3/dsh-friend-memory     # 记忆
dsh plugin --profile web add @wishp3/dsh-friend-growth     # 成长
dsh plugin --profile web add @wishp3/dsh-friend-reactions  # 工作陪伴
dsh plugin --profile web add @wishp3/dsh-friend-settings   # 配置中心
```

单独装时请同时装 `@wishp3/dsh-friend-shared`，以及你用到的包之间的依赖（例如舞台会用到 ASR）。不确定就装聚合包。

### 验证与卸载

重启 `dsh web` 之后：

- 设置导航出现 **dsh-Friend**
- `GET http://127.0.0.1:3080/friend/pet` 返回 200
- 形象列表里能看到奶龙和 Hiyori

也可以 `dsh --profile web --dump-config` 看插件层在不在。侧边栏或悬浮层没出来，多半是装完没重启。

卸载：`dsh plugin --profile web remove @wishp3/dsh-friend-all`，然后重启。开发链接用 `node scripts/link-profile.mjs --unlink`。

## 开发

```bash
export CI=true
pnpm test
pnpm typecheck
node scripts/aggregate.mjs --check
node scripts/release-scan.mjs --pack
```

壳：`cd apps/friend-shell && cargo test`。发布说明：[docs/release.md](docs/release.md)。

## 来源与版权

| 部分 | 来源 | 许可 |
| --- | --- | --- |
| 插件逻辑 | 衍生自 [Kokoro Engine](https://github.com/chyinan/Kokoro-Engine) | MIT（chyinan；本项目追加版权行） |
| 奶龙 Live2D | 整理自 [Diyeego/naiwa-pet](https://github.com/Diyeego/naiwa-pet/) | 保留上游署名；runtime zip 只进 git，不进 npm |
| Hiyori FREE / Cubism Core | Live2D 官方 | 用户同意条款后本机下载，不进仓库 |
| 本仓库其余源码 | wanghehe123 | MIT |

<details>
<summary>友情链接</summary>

- [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) —— DSH Web UI 插件与皮肤集合
- [dshfind](https://dshfind.com) —— DeepSeek Harness 学习与分享社区
- [deepseek-plugin-store](https://github.com/Ericwong5021/deepseek-plugin-store) —— 社区插件商店
- [dsh-pet](https://github.com/deepseek-ai/dsh-pet) —— 官方工作台吉祥物
- [dsh-plugin topic](https://github.com/topics/dsh-plugin)

</details>

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=wanghehe123/dsh-Friend&type=date&legend=top-left)](https://www.star-history.com/?repos=wanghehe123%2Fdsh-Friend&type=date&legend=top-left)
