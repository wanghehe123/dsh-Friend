# @wish233/dsh-friend-persona

角色卡存取、酒馆卡导入、预设注册、人格提示词分区。

Host 入口仍是 `src/index.ts`（由接线任务挂载）。本包已导出的模块：

- `src/store.ts` — 角色卡 CRUD、默认角色种子、数据根解析
- `src/tavern-import.ts` — SillyTavern PNG / JSON 导入

## 数据根目录解析优先级

`resolveFriendDataDir({ dshHome?, override?, env?, homedir? })` 是纯函数，**不会写死 `~/.dsh`**。第一个非空值生效：

1. `options.override` — 直接指定 friend 数据根（已含 `friend/`，测试注入用）
2. 环境变量 `FRIEND_DATA_DIR` — 同样是 friend 数据根
3. `options.dshHome` — 拼成 `<dshHome>/friend`
4. 环境变量 `DSH_HOME` — 拼成 `<DSH_HOME>/friend`（冒烟脚本的隔离临时 home 走这条）
5. `<homedir || os.homedir()>/.dsh/friend`

角色卡路径：`<friendDataDir>/characters/<slug>/persona.json`。

单元测试一律把 `override` 指到 `os.tmpdir()`；读取默认回退时传入 `env: {}`，避免本机真实 `DSH_HOME` 泄漏进断言。

## 角色卡 schema

写入前校验这些字段（手写类型守卫，不引入 zod，也不运行时依赖 `@deepseek-ai/schemastery`）：

| 字段 | 类型 | 约束 |
|---|---|---|
| `name` | string | 必填，trim 后非空 |
| `personality` | string | 必填 |
| `background` | string | 必填 |
| `speakingStyle` | string | 必填 |
| `language` | string | 必填 |
| `nickname` | string | 必填（对用户的称呼） |
| `greetings` | string[] | 必填（可空数组） |
| `live2dModel` | string? | 若出现必须是字符串 |
| `voice` | string? | 若出现必须是字符串 |
| `tags` | string[] | 必填（可空数组） |

校验失败抛出 `PersonaValidationError`（可读中文），**不会改写磁盘上的原文件**。存储层不缓存卡片内容，外部编辑器改完下次 `get`/`list` 即可见。

中文名会生成可用 slug（保留 CJK）；重名自动加 `-2`、`-3` 后缀。首次启动调用 `seedDefault()`：仅当 `characters/default/persona.json` 不存在时写入内置「小友」，已存在则不覆盖。

## 酒馆卡导入回退

`importTavernCardJson` / `importTavernCardPng` 兼容 V1 顶层字段、V2 `data` 包装、V3 `chara_card_v3`。PNG 读 `tEXt`/`iTXt` 的 `chara`（其次 `ccv3`）chunk。缺省字段：

| persona 字段 | 酒馆来源 | 回退 |
|---|---|---|
| `name` | `data.name` / `char_name` | `Unnamed Character` |
| `personality` | `data.personality` | `""` |
| `background` | `description`/`char_persona` + `scenario`/`world_scenario` | `""` |
| `speakingStyle` | `system_prompt`，否则 `post_history_instructions`；若有 `mes_example` 则追加 | `""` |
| `language` | `extensions.language` / `speak_language` | `zh-CN` |
| `nickname` | `extensions.nickname`；`{{user}}` 视为未设 | `你` |
| `greetings` | `first_mes`/`char_greeting` + `alternate_greetings` | `[]` |
| `live2dModel` | `extensions.live2dModel` / `live2d` | 省略 |
| `voice` | `extensions.voice` | 省略 |
| `tags` | `data.tags` | `[]` |

导入结果会再走一遍 persona schema，因此可以直接 `store.create(...)`。
