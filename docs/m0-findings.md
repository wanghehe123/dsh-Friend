# W-M0-6 探路清单收敛

- **调研日期**：2026-08-14
- **证据范围**：本机已安装的官方 SDK 类型与实现（只读，未改仓库其它文件，未跑 install/test）
- **SDK 版本**（各包 `package.json` 的 `version` 字段）：

| 包 | 版本 |
|---|---|
| `@deepseek-ai/cordis` | 4.0.1 |
| `@deepseek-ai/schemastery` | 3.18.1 |
| `@deepseek-ai/dsh-host-webserver` | 0.1.0-rc.6 |
| `@deepseek-ai/dsh-settings` | 0.1.0-rc.6 |
| `@deepseek-ai/dsh-client-runtime` | 0.1.0-rc.6 |
| `@deepseek-ai/dsh-client-ui-slots` | 0.1.0-rc.6 |
| `@deepseek-ai/dsh-client-ui-conversation` | 0.1.0-rc.6 |
| `@deepseek-ai/dsh-client-connection` | 0.1.0-rc.6 |

下列包不在 `node_modules/@deepseek-ai/` 顶层，但是 listed SDK 的已安装传递依赖，探路 1 / 5 必须读它们才能得到一手结论：

| 包 | 版本 | 为何必须读 |
|---|---|---|
| `@deepseek-ai/dsh-agent-presets` | 0.1.0-rc.6 | Agent 预设的真实形态（文件系统发现，无 `register`） |
| `@deepseek-ai/dsh-system-prompt` | 0.1.0-rc.6 | `ctx.systemPrompt.section()` |
| `@deepseek-ai/dsh-tools` | 0.1.0-rc.6 | `defineTool` / `ctx.tools.register` / `restrict` |
| `@deepseek-ai/dsh-client-ui-settings` | 0.1.0-rc.6 | 设置槽位 + `ctx.settingsScope.bind` |
| `@deepseek-ai/dsh-api-remotes` | 0.1.0-rc.6 | host→client 事件转发白名单（封闭） |
| `@deepseek-ai/dsh-host-apiproxy` | 0.1.0-rc.6 | `MuxFrame` / `HostFrame` 闭包联合 |

---

## 结论摘要

| # | 问题 | 状态 | 采用方案 |
|---|---|---|---|
| 1 | Agent 预设注册 | **已选兜底** | rc.6 **没有** `registerPreset()`；预设 = 含 `agent.cordis.yml` 的目录，由 `ctx.agentPresets` 发现。friend 必须**随包投放预设目录**并把它加入 `agent-presets.roots`（或写入用户根 `~/.dsh/.agent-presets/`）。工具白名单用预设常驻挂载里的 `tools.restrict({ allow })`。 |
| 2 | 整页 / 路由级 client 槽位 | **已确认** | `dsh-client-ui-slots` 自身 **SlotMap 为空**。已安装 SDK 里没有路由级整页槽。配置中心：**设置页走 `settings.section`**；占满视口的配置中心走 **自建全屏覆盖层**（勿占 `root`）。 |
| 3 | host HTTP 路由注册 | **已确认** | `ctx.webServer.register(route)` 返回同步 disposer；现有 `registerRoute` 用 `ctx.effect` 绑 fiber，**与 SDK 一致**。须补 `kind`，勿把路由写成 GET-only。 |
| 4 | host → client 推送 | **已选兜底** | 官方有 `/api/events.mux` + `/api/events.host` WebSocket，以及 `host/remote-event` 转发，但帧类型与事件名都是**封闭白名单**，插件加不进去。采用自建 SSE：`GET /friend/events`。 |
| 5 | 系统提示词分区 / 工具注册 | **已确认** | `ctx.systemPrompt.section({ name, order, text })`；工具用 `defineTool` + `ctx.tools.register`。可见性靠 **调用方 scope**（预设常驻层）+ `tools.restrict`。**不能**在 host 全局 ctx 上 `restrict`。 |

---

## 1. Agent 预设注册

### 结论（已选兜底）

rc.6 **未暴露**「传入系统提示词 + 工具白名单即可注册一个预设」的运行时 API。`ctx.agentPresets` 只有发现 / 挂载 / 复制 / 删除。

一个预设的真实形态：

1. 目录名 = 预设 id，必须匹配 `/^[a-z0-9][a-z0-9-]*$/`（`friend-companion` 合法）。
2. 目录内必须有组装文件 **`agent.cordis.yml`**（不是普通 `cordis.yml`）。
3. 可选旁路文件 **`preset.yml`**，只放展示用 `name` / `description` / `order`。
4. roster 在配置的 `roots` 上扫描；默认再追加 harness home 下的用户根 **`.agent-presets`**（`trust: user`）。
5. 每个预设在进程内**常驻挂载一次**；会话通过 `agent → preset → global` 的 scope 父链加入。工具、提示词分区、投影单元都挂在这份常驻层上。
6. 创作写入**只有整目录复制**（`copy(from, id, name?)`）。组装文本**不准**经过这道 API。

因此 `friend-companion` / `friend-companion-plus` 不能靠 `ctx.xxx.registerPreset({ tools, prompt })` 变出来，必须**投放目录 + 让发现器看见它**。

### 证据

模块总述（无 register，只有发现与常驻挂载）：

```1:21:/Volumes/WishDisk/codes/dsh-Friend/node_modules/.pnpm/@deepseek-ai+dsh-agent-presets@0.1.0-rc.6_4c20af7d23bdb1bbe92fd5e1e7ddef5d/node_modules/@deepseek-ai/dsh-agent-presets/lib/types/index.d.ts
 * Agent presets: each session composes its model-facing plugin set from one
 * preset `cordis.yml`, mounted ONCE per preset under a standing scope and
 * joined by every agent that names it.
 * ...
 * This package owns the preset vocabulary, filesystem discovery, and the
 * guarded standing mount. It does not decide when an agent is created — the
 * agent factory's `setup(agentCtx)` hook is the one supported call site,
```

`AgentPresets` 公开方法（读过完整 class）：`list` / `resolve` / `mount` / `composeFrom` / `composedPreset` / `recompose` / `read` / `copy` / `remove` / `standingKeyFor` / `serviceFor`。**没有 `register`。**

组装文件名与用户根：

```17:32:/Volumes/WishDisk/codes/dsh-Friend/node_modules/.pnpm/@deepseek-ai+dsh-agent-presets@0.1.0-rc.6_4c20af7d23bdb1bbe92fd5e1e7ddef5d/node_modules/@deepseek-ai/dsh-agent-presets/lib/types/discovery.d.ts
export declare const COMPOSITION_FILE = "agent.cordis.yml";
// ...
export declare const USER_PRESET_DIR = ".agent-presets";
```

id 约束（实现常量，与 `.d.ts` 的 `PRESET_ID: RegExp` 对应）：

```10:10:/Volumes/WishDisk/codes/dsh-Friend/node_modules/.pnpm/@deepseek-ai+dsh-agent-presets@0.1.0-rc.6_4c20af7d23bdb1bbe92fd5e1e7ddef5d/node_modules/@deepseek-ai/dsh-agent-presets/lib/types/preset.js
export const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;
```

创作只有 copy，且「组装文本不经过这道接缝」：

```7:11:/Volumes/WishDisk/codes/dsh-Friend/node_modules/.pnpm/@deepseek-ai+dsh-agent-presets@0.1.0-rc.6_4c20af7d23bdb1bbe92fd5e1e7ddef5d/node_modules/@deepseek-ai/dsh-agent-presets/lib/types/authoring.d.ts
 * The only authoring write is a whole-directory copy of an existing preset.
 * No caller supplies composition text: the inputs are ids the host resolves
 * against its own roots plus an optional display name, so authoring grants no
 * capability the copied preset did not already carry.
```

工具白名单必须在**带 scope 的 ctx**上调用；host 全局 ctx 会直接抛：

```2772:2774:/Volumes/WishDisk/codes/dsh-Friend/node_modules/.pnpm/@deepseek-ai+dsh-tools@0.1.0-rc.6_f8724372086ccc1457fc84e7becee2e0/node_modules/@deepseek-ai/dsh-tools/lib/index.js
	restrict(filter) {
		const scope = scopeOf(this.ctx);
		if (scope === void 0) throw new Error("tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent — deny the tool for the intended agent instead");
```

README 写明解析链是 `agent → preset → global`，近者遮蔽远者（`dsh-agent-presets/README.zh.md` 第 7 段）。

### 建议的 compat 封装签名

```ts
import type { Context } from '@deepseek-ai/cordis'

/** 最小 host 面：只摸 roster，不把整个 Context 漏给功能包。 */
export interface FriendPresetContext {
  agentPresets: {
    resolve(id?: string): Promise<{ id: string; broken?: string }>
    list(): Promise<ReadonlyArray<{ id: string; broken?: string }>>
  }
}

export interface FriendPresetSpec {
  /** 目录名 / roster id，须匹配 /^[a-z0-9][a-z0-9-]*$/ */
  id: 'friend-companion' | 'friend-companion-plus' | (string & {})
}

/**
 * rc.6 没有 register API。本函数只做启动期 fail-loud：
 * 断言投放的预设目录已被发现且可挂载。
 * 真正的「注册」是组装期投放 `presets/<id>/agent.cordis.yml`
 * 并把该父目录写入 agent-presets.roots（trust: system）。
 */
export async function registerPreset(
  ctx: FriendPresetContext,
  spec: FriendPresetSpec,
): Promise<void>
```

预设目录（不在 compat 里写 YAML，由 persona 包投放）应长这样：

```text
presets/friend-companion/
  agent.cordis.yml    # 插件行：persona / memory / stage 等（只放要进伴侣 scope 的包）
  preset.yml          # name / description / order
```

`agent.cordis.yml` 里的包在**预设常驻 ctx**上执行，从而：

- `registerTool` / `registerPromptSection` 落在 preset 层（编码会话看不见）
- `ctx.tools.restrict({ allow: [...] })` 合法（有 scope），把 bash 等全局工具从伴侣会话摘掉
- 限制只过滤**继承来的全局工具**；本层自己 `register` 的工具不受 `allow` 剔除（`ToolRuntime.view` 注释，`dsh-tools/lib/types/index.d.ts` 约 625–637 行）

### 兜底方案

| 优先级 | 做法 | 何时用 |
|---|---|---|
| A（首选） | 随包投放 `presets/<id>/`，在聚合 `cordis.patch.yml` 里给 `agent-presets.roots` 加一条 `trust: system` 的根 | 能改 host 组装时 |
| B | 插件启动时把同一份目录写进 `<dshHome>/.agent-presets/<id>/`（用户根，默认会被扫到） | 不能改 agent-presets 配置时 |
| C | **不要**在 host 全局注册伴侣工具再幻想 `restrict`——全局 `restrict` 会抛；全局 `register` 会泄漏到编码会话 | 禁止当作主路径 |

`copy()` **不能**从零造出 friend 组装：它只能复制已有预设，且不接受组装文本。B 是在用发现约定写文件，不是在调用官方 register。

---

## 2. 整页 / 路由级 client 槽位

### 结论（已确认）

`@deepseek-ai/dsh-client-ui-slots` **不暴露任何槽位名**。它只提供空的 `SlotMap` + `SlotCore.register`。槽位名靠其它包装 `declare module` 合并进来。

已安装 SDK 里：

- **没有**路由级 / URL 级 / 「整页应用」槽。
- 唯一接近「整页」的是 **`root`**（single）。官方注释写明：**不要往这里注册**，否则会阴影掉整个 AppFrame。
- 设置相关槽都是**设置面板内部**的页 / 行 / 标签，不是独立路由。
- 迁移计划里的 `settings.plugin.item` **不存在**。对应的是 `settings.general.item`（通用区一行）或 `settings.section`（独立设置页）或 `settings.plugins.tab`（插件区标签页）。

配置中心决策：

- 设置面板里的入口 / 表单页 → 官方槽 **`settings.section`**（可选再加 `settings.general.item` 当跳转按钮）。
- 占满视口、带十分区导航的配置中心 → **自建全屏覆盖层**（client 自渲染）。`shell.overlay` 在 runtime 注释里被说成官方叠加座，但声明它的 `dsh-client-ui-layout` **未出现在本安装树**，compat 现在不能依赖这个类型。

### 证据

ui-slots 的 SlotMap 是空的：

```16:18:/Volumes/WishDisk/codes/dsh-Friend/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts
/** Slot contract table. Owners extend via declaration merging; entries are {@link SlotEntryDef}. */
export interface SlotMap {
}
```

`root` 与「去 shell.overlay」的警告：

```17:36:/Volumes/WishDisk/codes/dsh-Friend/node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/slots.d.ts
        /**
         * The built-in render-tree root hole ...
         * DO NOT register here. ...
         * For a surface of your own that floats over the whole
         * app, register into `shell.overlay` instead (a list slot: additive, and
         * click-through until your entry opts into pointer events).
         */
        'root': {
            kind: 'single';
            scope: 'root';
            owner: RootOwnerProps;
        };
```

设置页槽（`settings.section` = 每功能一页，仍在设置面板里）：

```56:71:/Volumes/WishDisk/codes/dsh-Friend/node_modules/.pnpm/@deepseek-ai+dsh-client-ui-settings@0.1.0-rc.6_@deepseek-ai+cordis@4.0.1_@deepseek-ai+d_05ef59874a88a63cf4628e3bf921c640/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/types/client/contract/slots.d.ts
        /**
         * One settings page per list entry. ...
         * Sections render inside the panel content column.
         */
        'settings.section': {
            kind: 'list';
            scope: 'root';
            owner: SettingsSectionOwnerProps;
        };
```

在已安装的 `.d.ts` 里搜索不到名为 `page` / `route` / `fullscreen` / `app.page` 的 SlotMap 键。`dsh-client-ui-layout` 不在本树中。

### `dsh-client-ui-slots` 暴露的槽位名

**本包：无。** 下面是本安装树里通过声明合并能看到的全部 SlotMap 键。

#### A. `@deepseek-ai/dsh-client-runtime` 合并

| 槽位名 | kind | scope | 语义 |
|---|---|---|---|
| `root` | single | root | 整棵渲染树的根洞。已被 AppFrame 占用。再注册会阴影掉整页。 |

#### B. `@deepseek-ai/dsh-client-ui-conversation` 合并

| 槽位名 | kind | scope | 语义 |
|---|---|---|---|
| `conversation.session` | single | session | 整段会话体。占了就要自己画整段对话。 |
| `conversation.session.header` | single | session | 标题 / 视图标签 / 操作行整条顶栏。 |
| `conversation.session.header.actions` | list | session | 顶栏标题旁的加法按钮。 |
| `conversation.session.header.utilities` | list | session | 顶栏右侧工具，不打乱标题旁操作。 |
| `conversation.view` | list | session | 会话视图环（chat / trajectory…），按 `only` 一次只画一个。 |
| `conversation.chat.node` | keyed | session | 按 `ChatNodeKind` 分发的聊天气泡节点。 |
| `conversation.chat.commandview` | keyed | session | 按 slash 命令名分发的命令行卡片。 |
| `conversation.chat.turnTail` | chain | session | 已完成 Turn 的扩展链（selector 选举）。 |
| `conversation.chat.assistant-actions` | list | session | 一条已定稿助手消息上的动作条。 |
| `conversation.details.tool` | single | session | 详情面板里「当前选中工具调用」的整页输出。 |
| `conversation.composer` | chain | session | 输入条接管链（审批等）。 |
| `conversation.composer.bar` | single | session-maybe | 默认输入条本体（chain 的 fallback，接管时隐藏不卸载）。 |
| `conversation.composer.dock` | list | session | 输入卡片**下方**的环境读数（官方统计行）。 |
| `conversation.input.dock` | list | session | 输入卡片**上方**的整行（队列 / todo / 目标条）。 |
| `conversation.input.left` | list | session | 输入卡片工具行左侧小控件。 |
| `conversation.input.right` | list | session | 同一工具行右侧、发送键之前。 |
| `conversation.input.plan` | single | session | 计划状态位；空则不占布局。 |
| `conversation.input.model` | single | session | 模型选择位。 |
| `conversation.hero.workspace` | single | root | 空白会话英雄区的工作区选择器。 |
| `conversation.hero.agentPreset` | single | root | 空白会话旁的预设芯片。 |

#### C. `@deepseek-ai/dsh-client-ui-settings` 合并（设置域底座；ui-slots 本身没有这些名字）

| 槽位名 | kind | scope | 语义 |
|---|---|---|---|
| `settings.trigger` | single | root | 侧栏底部「打开设置」触发器内容。 |
| `settings.header` | single | root | 设置面板标题文字。 |
| `settings.action` | list | root | 内容栏标题上、关闭键之前的操作。 |
| `settings.close` | single | root | 关闭键的无障碍标签（键本身是壳画的）。 |
| `settings.section` | list | root | **每功能一页**，在设置面板内容栏里。`id` / `order` / `label` 做导航。 |
| `settings.plugins.tab` | list | root | 「插件」分区里的功能页（标签）。 |
| `settings.onboarding` | list | root | 设置驱动的 onboarding 步骤。 |
| `settings.general.item` | list | root | 通用区里的**一行**偏好（不是整页）。 |

#### D. 注释里出现、本安装树没有类型声明的名字

| 名字 | 出处 | 说明 |
|---|---|---|
| `shell.overlay` | runtime 对 `root` 的注释 | 官方加法叠加层；声明包 `dsh-client-ui-layout` 未安装。 |
| `sidebar` / `conversation` / `details` | 同上（AppFrame 子座） | 声明包未安装。`ConversationSlotProps` 把 `'conversation'` / `'details'` 当作父槽引用。 |
| `conversation.input.overlay` | `ConversationSlotProps` 的 children 联合 | 对话包引用了，本树未见 SlotMap 条目。 |
| `sidebar.settings` | ui-settings README | 设置壳占用的侧栏座，类型在未安装的 ui-settings-general。 |
| `settings.plugin.item` | 本仓库 `docs/migration-plan.md` | **rc.6 无此键**。 |

### 建议的 compat 封装签名

槽位注册本身不是六封装之一。配置中心只需要约定座位，不要封装一个假的 `registerFullPage`：

```ts
/** 设置面板里的 Friend 页（官方 list 槽）。 */
export const FRIEND_SETTINGS_SECTION = 'settings.section' as const

/**
 * 占满视口的配置中心：rc.6 无官方整页/路由槽。
 * 实现放在 friend client 包，自建 overlay（fixed inset-0）。
 * 若日后装上 ui-layout 且 SlotMap 出现 shell.overlay，再把 overlay 迁进该 list 槽。
 */
export const FRIEND_CONFIG_CENTER_STRATEGY = 'self-overlay' as const
```

### 兜底方案

自建全屏覆盖层（client 半区 React）：`position: fixed; inset: 0; z-index` 压过会话壳；hash 路由（`#/friend/config/...`）可分享；关闭回到设置页。入口用 `settings.section` 或 `settings.general.item` 放一颗按钮。**禁止**往 `root` 注册。

---

## 3. host HTTP 路由注册

### 结论（已确认）

`ctx.webServer.register(route)` 是官方 API。现有 `packages/dsh-friend-shared/src/dsh-compat.ts` 的 `registerRoute` **与 rc.6 一致**：`register` 返回同步 disposer，必须再交给 `ctx.effect` 才能跟插件 fiber 一起卸。

路由**不按 HTTP method 分流**。`handler` 吃整段 `IncomingMessage` / `ServerResponse`，也可以把响应一直开着（类型注释点名 SSE）。

### 证据

```19:72:/Volumes/WishDisk/codes/dsh-Friend/node_modules/@deepseek-ai/dsh-host-webserver/lib/types/index.d.ts
export type WebRouteKind = 'exact' | 'prefix';
export interface WebRoute {
    kind: WebRouteKind;
    /** Absolute pathname, no trailing slash. */
    path: string;
    /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
    // ...
    /**
     * Register a named route. Duplicate (kind, path) throws — ...
     * @returns the disposer removing the route.
     */
    register(route: WebRoute): () => void;
```

实现：按 `kind` 进 exact / prefix 表，disposer 只 `delete`，**不**自动 `ctx.effect`：

```53:60:/Volumes/WishDisk/codes/dsh-Friend/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js
	register(route) {
		const table = route.kind === "exact" ? this.exact : this.prefixes;
		if (table.has(route.path)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`);
		table.set(route.path, route);
		return () => {
			table.delete(route.path);
		};
	}
```

匹配：先 exact，再最长 prefix，最后 fallback。`path` 与 `path/` 都算 prefix 命中（`lib/index.js` 194–200 行）。

`ctx.effect`（cordis 4.0.1）：

```144:159:/Volumes/WishDisk/codes/dsh-Friend/node_modules/@deepseek-ai/cordis/lib/types/fiber.d.ts
     * Register a cleanup-aware effect on this fiber.
     * `execute` runs immediately; the disposers it produces are collected and
     * run (in reverse order) either when the returned disposer is called or
     * when the fiber unloads, whichever comes first.
     */
    effect(execute: () => SyncEffect, label?: string): Disposable<Promise<void>>;
    effect(execute: () => Effect, label?: string): AsyncDisposable<Promise<void>>;
```

现有封装：

```25:30:/Volumes/WishDisk/codes/dsh-Friend/packages/dsh-friend-shared/src/dsh-compat.ts
export function registerRoute(ctx: FriendRouteContext, route: WebRoute): () => void | Promise<void> {
  return ctx.effect(
    () => ctx.webServer.register(route),
    `dsh-friend: GET ${route.path}`,
  )
}
```

### 与现有 `registerRoute` 的偏差

| 项 | SDK | 现有 compat | 严不严重 |
|---|---|---|---|
| 方法名 | `webServer.register` | 正确 | — |
| `WebRoute` 形状 | `{ kind, path, handler }` | 原样传入 `WebRoute` | 一致 |
| 返回值 | `register` → `() => void`；`effect` → `() => Promise<void>` | `() => void \| Promise<void>` | 略宽，可调用 |
| 是否绑 fiber | `register` **不**绑；调用方必须 `effect` | 已包 `ctx.effect` | **正确，且必要** |
| `kind` | 必填 `'exact' \| 'prefix'` | 类型有，调用方必须自己传 | 文档里要写死：`/friend/*` 用 `exact`，除非真要前缀 |
| `path` | 绝对路径、**禁止尾斜杠** | 未校验 | 建议在封装里 assert |
| 重复 `(kind, path)` | throw | 原样冒泡 | 保持 |
| label 写成 `GET` | 路由与 method 无关 | 误导 | 改成 `dsh-friend: ${kind} ${path}` |
| `registerUpgrade` | 另有 upgrade 表 | 未封装 | SSE 用 HTTP 即可；自建 WS 再包 |
| `FriendRouteContext.effect` | Fiber 还接受 iterable / async effect | 只接受单个 disposer | 对路由够用 |

### 建议的 compat 封装签名

保持现有函数，收紧 label 与 path 约定：

```ts
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'

export interface FriendRouteContext {
  webServer: Pick<WebServer, 'register'>
  effect(
    execute: () => () => void | Promise<void>,
    label?: string,
  ): () => void | Promise<void>
}

export function registerRoute(
  ctx: FriendRouteContext,
  route: WebRoute,
): () => void | Promise<void> {
  if (route.path.endsWith('/') && route.path !== '/') {
    throw new Error(`dsh-friend: route path must not end with "/": ${route.path}`)
  }
  return ctx.effect(
    () => ctx.webServer.register(route),
    `dsh-friend: ${route.kind} ${route.path}`,
  )
}
```

### 兜底方案

若未来 `register` 改名或不再返回 disposer：只改这一处。备选仍是 `ctx.webServer` 上的 `registerFallback`（单座，已被 SPA 占用，**不要抢**）或自建 `node:http`（会和官方监听撞端口，禁止）。

---

## 4. host → client 推送

### 结论（已选兜底）

官方有一条「HTTP 上、WebSocket 下」的双流，但那是 **dsh 自己的会话/宿主协议**，不是插件推送总线。

已确认存在、但不能给 Friend 用的 seam：

1. WebSocket 下行：`/api/events.mux`、`/api/events.host`。客户端在这些 socket 上发业务数据算协议违规。普通 GET 这些路径返回 426，**没有 SSE 回退**。
2. 帧类型是封闭联合：`MuxFrame`（`session/event`、审批、队列…）和 `HostFrame`（会话增删、工作区变更…）。
3. `host/remote-event` 可以把 host 上的 cordis 事件原样转给 `ctx.remote.$on`，但事件名白名单写死在 `@deepseek-ai/dsh-api-remotes`，插件**加不进** `friend/expr` 这类名字。
4. `ctx.connection.rpc` 是 **client → host** 的一元 RPC（`call` / `handle` / `intercept`），host 不能先开口。

因此：**没有**「host 主动推一条任意业务消息到浏览器」的官方插件 API。采用迁移计划已写的自建 SSE。

### 证据

路径常量：

```6:11:/Volumes/WishDisk/codes/dsh-Friend/node_modules/@deepseek-ai/dsh-client-connection/lib/types/api-path.d.ts
export declare const API_PATH = "/api";
export declare const MUX_EVENTS_PATH = "/api/events.mux";
export declare const HOST_EVENTS_PATH = "/api/events.host";
```

下行 WebSocket，上行仍走 HTTP：

```1:8:/Volumes/WishDisk/codes/dsh-Friend/node_modules/@deepseek-ai/dsh-client-connection/lib/types/websocket-downlink.d.ts
/** Host-side WebSocket carrier for the two server-to-browser event streams. */
// ...
 * Owns WebSocket negotiation and frame pumping for the connection plugin's
 * two downlinks. Client messages are a protocol violation: upstream traffic
 * remains on HTTP.
```

README 明确：这两条路径不做 SSE 回退（`dsh-client-connection/README.zh.md`「`/api` WebSocket 下行」节）。

`HostFrame` 含 `host/remote-event`，但白名单封闭：

```206:209:/Volumes/WishDisk/codes/dsh-Friend/node_modules/.pnpm/@deepseek-ai+dsh-host-apiproxy@0.1.0-rc.6_e9efce95e5e57cd2168691beebd30eb1/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api/events.d.ts
 | {
    type: 'host/remote-event';
    event: string;
    args: JsonValue[];
}
```

```16:16:/Volumes/WishDisk/codes/dsh-Friend/node_modules/.pnpm/@deepseek-ai+dsh-api-remotes@0.1.0-rc.6_963f21f11cddd09def26a2473cddd8c5/node_modules/@deepseek-ai/dsh-api-remotes/lib/types/remote-events.d.ts
export declare const API_REMOTE_FORWARDED_EVENTS: readonly ["agent-preset/selected", "commands/change", "credentials/updated", "cordis/request-run", "cordis/request-run-resolved", "cordis/dynamic-package", "cordis/dynamic-retract", "cordis/inspect-query", "cordis/inspect-query-resolved", "llm/adapters-updated", "settings/document-updated"];
```

「再转发一个事件 = 只改这一处数组」。Friend 改不了这个包。

RPC 是 client 发起：

```40:49:/Volumes/WishDisk/codes/dsh-Friend/node_modules/@deepseek-ai/dsh-client-connection/lib/types/rpc.d.ts
export interface ClientConnectionRpc {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult<unknown>>;
}
```

官方 HTTP 路由**允许** handler 把响应开着做 SSE（见第 3 节 `WebRoute.handler` 注释）。这是自建 SSE 的合法载体，不是在滥用未文档化行为。

### 建议的 compat 封装签名

```ts
export type FriendPushEvent =
  | { type: 'expr'; payload: unknown }
  | { type: 'motion'; payload: unknown }
  | { type: 'cue'; payload: unknown }
  | { type: 'reaction'; payload: unknown }
  | { type: 'tts-ready'; payload: unknown }
  | { type: 'asset-progress'; payload: unknown }

export interface FriendPushHandle {
  /** host：推给当前所有 SSE 订阅者。无人听时丢弃（或按实现选择 ring buffer）。 */
  push(event: FriendPushEvent): void
  /** 卸插件时关掉所有开着的 SSE 响应。 */
  dispose: () => void | Promise<void>
}

/**
 * 在 ctx.effect 里 registerRoute({ kind: 'exact', path: '/friend/events', handler })。
 * 返回的 handle.push 是功能包唯一允许的推送口。
 */
export function pushToClient(ctx: FriendRouteContext): FriendPushHandle
```

### 兜底方案（自建 SSE 要注意什么）

1. **路径**：`kind: 'exact', path: '/friend/events'`。不要挂到 `/api/*`（connection 的信任栅栏 + 前缀所有权）。
2. **method**：handler 里只接受 GET；其它 method 回 405。`register` 本身不管 method。
3. **响应头**：`Content-Type: text/event-stream`、`Cache-Control: no-cache`、`Connection: keep-alive`。按 `type` 字段写 `event:` 行，便于 `EventSource` 分发。
4. **生命周期**：每个连接推进一个集合；`ctx.effect` 的 disposer 必须 `res.end()` 全部连接。插件热重载否则会漏 fd。
5. **心跳**：隔 15–30s 写 `: ping\n\n`，避免中间代理掐空闲连接。
6. **多标签**：每个 EventSource 都是独立订阅；`push` 广播。不要假设只有一个浏览器页。
7. **重连**：`EventSource` 会自动重连。进度类事件（`asset-progress`）要可重入（快照或可重复的百分比），不要只推 delta。
8. **信任**：`dsh-host-webserver` **没有**认证。默认绑 `127.0.0.1`。不要在 SSE 里推 TTS key、路径里的秘密。
9. **Electron / `file://`**：webserver 自述是 Web 载体；Electron 用 `file://` + IPC 搬 fetch。`EventSource` 打 loopback 可能碰到 CORS / 混合内容。M1 先保证 `dsh web`；桌面壳若打不通，再在 compat 里加短轮询 `GET /friend/events?since=`，不要让功能包分叉。
10. **不要** `ctx.emit('friend/expr')` 指望它出现在 `ctx.remote.$on` 上——不在白名单里就不会转发。
11. **不要**占用 `/api/events.*` 或往官方 `MuxFrame` 塞私有 `type`。

---

## 5. 系统提示词分区 / 工具注册

### 结论（已确认）

两套官方 API 都在，而且已经按调用方 scope 分层：

- **提示词分区**：`ctx.systemPrompt.section({ name, order, text, complete? })` → 已是 Cordis effect disposer。同名 scoped section 阴影全局；`deployment:persona`（order 0）是部署人设槽，预设用同名 section 就能换掉它。
- **工具**：`defineTool({ name, description, parameters, output, execute })` 得到 `ToolDefinition`，再 `ctx.tools.register(definition)`。`parameters` 是 schemastery 风格的属性表，编译成 JSON Schema。`output.schema` + `output.render` **必填**。
- **只让某个预设看见**：在该预设的常驻挂载 ctx（或 `agent.ctx`）上注册。视图链是 `agent → preset → global`。`tools.restrict({ allow | deny })` 只裁剪**继承来的全局工具**，且**必须**在 scoped ctx 上调用。
- **没有** `registerTool({ presetId })` 这种按 id 过滤的参数。过滤 = 你在哪一层 `register` / `restrict`。

### 证据

`PromptSection` 与 `section()`：

```46:68:/Volumes/WishDisk/codes/dsh-Friend/node_modules/.pnpm/@deepseek-ai+dsh-system-prompt@0.1.0-rc.6_@deepseek-ai+cordis@4.0.1_@deepseek-ai+dsh-in_ae19c1446da8797d55176bf5f8e2b0ad/node_modules/@deepseek-ai/dsh-system-prompt/lib/types/index.d.ts
export interface PromptSection {
    readonly name: string;
    readonly order: number;
    readonly text: string | ((context: AssembleContext) => string);
    readonly complete?: boolean;
}
```

```179:187:/Volumes/WishDisk/codes/dsh-Friend/node_modules/.pnpm/@deepseek-ai+dsh-system-prompt@0.1.0-rc.6_@deepseek-ai+cordis@4.0.1_@deepseek-ai+dsh-in_ae19c1446da8797d55176bf5f8e2b0ad/node_modules/@deepseek-ai/dsh-system-prompt/lib/types/index.d.ts
    /**
     * Register an ordered prompt section in the calling context's scope. A scoped
     * section shadows a global section with the same name; ...
     * @returns the exact Cordis effect disposer.
     */
    section(section: PromptSection): () => void;
```

实现已走 `layers.effect(this.ctx, …)`（`dsh-system-prompt/lib/index.js` 186–188 行），会跟调用方 fiber 一起卸。order 约定：`-100` harness 身份，`0` 人设，工具指引 `100–199`。

`defineTool`：

```177:239:/Volumes/WishDisk/codes/dsh-Friend/node_modules/.pnpm/@deepseek-ai+dsh-tools@0.1.0-rc.6_f8724372086ccc1457fc84e7becee2e0/node_modules/@deepseek-ai/dsh-tools/lib/types/schema.d.ts
export interface DefineToolOptions<S extends ParameterSchemaSpec, O extends ValueSchemaSpec> {
    readonly name: string;
    readonly description: string;
    readonly parameters: S;
    readonly output: {
        readonly schema: O;
        render(args: InferArgs<S>, value: InferValue<NoInfer<O>>): ContentBlock[];
        presentationMeta?(args: InferArgs<S>, value: InferValue<NoInfer<O>>): JsonValue;
    };
    execute(args: InferArgs<S>, exec: ToolRunContext): Promise<InferValue<NoInfer<O>>>;
    // timeoutMs / isConcurrencySafe / finalizeContent / presentCall / presentResult 可选
}
export declare function defineTool<const S extends ParameterSchemaSpec, const O extends ValueSchemaSpec>(options: DefineToolOptions<S, O>): ToolDefinition;
```

`register` / `restrict`：

```597:611:/Volumes/WishDisk/codes/dsh-Friend/node_modules/.pnpm/@deepseek-ai+dsh-tools@0.1.0-rc.6_f8724372086ccc1457fc84e7becee2e0/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts
    /**
     * Register globally or in the calling agent scope. Scoped tools shadow
     * globals; ...
     */
    register(definition: ToolDefinition): () => void;
    /**
     * Restrict global tools for the calling agent scope. ...
     * Restrictions intersect; scoped registrations remain visible.
     */
    restrict(filter: ToolRestriction): () => void;
```

```474:479:/Volumes/WishDisk/codes/dsh-Friend/node_modules/.pnpm/@deepseek-ai+dsh-tools@0.1.0-rc.6_f8724372086ccc1457fc84e7becee2e0/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts
export interface ToolRestriction {
    readonly allow?: readonly string[];
    readonly deny?: readonly string[];
}
```

### 建议的 compat 封装签名

```ts
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import { defineTool, type ToolDefinition, type ToolRestriction } from '@deepseek-ai/dsh-tools'

export interface FriendPromptContext {
  systemPrompt: { section(section: PromptSection): () => void }
}

export interface FriendToolContext {
  tools: {
    register(definition: ToolDefinition): () => void
    restrict(filter: ToolRestriction): () => void
  }
}

/** 已是 effect disposer；compat 原样返回，不要再套一层 ctx.effect。 */
export function registerPromptSection(
  ctx: FriendPromptContext,
  section: PromptSection,
): () => void {
  return ctx.systemPrompt.section(section)
}

/**
 * 接受 defineTool 的产物或手写 ToolDefinition。
 * 必须从预设常驻挂载 / agent.ctx 调用，才能把工具限制在伴侣会话。
 */
export function registerTool(
  ctx: FriendToolContext,
  definition: ToolDefinition,
): () => void {
  return ctx.tools.register(definition)
}

/** 仅 companion 预设挂载里调用。host 全局 ctx 会抛。 */
export function restrictTools(
  ctx: FriendToolContext,
  filter: ToolRestriction,
): () => void {
  return ctx.tools.restrict(filter)
}

export { defineTool }
```

伴侣人格分区建议：`name: 'friend:persona'`，`order` 取 `0` 且仅当要阴影 `deployment:persona` 时才用同名 `deployment:persona`；否则用正 order（例如 `10`）叠在人设后面，避免误换掉部署人设。行为守则可用 `name: 'friend:conduct'`、`order: 20`。`text` 做成 `(assembleCtx) => string`，按当前角色卡渲染。

### 兜底方案

| 情况 | 做法 |
|---|---|
| `systemPrompt` 服务不在组装里 | 启动期 fail-loud；不要把人格写进用户消息冒充系统提示 |
| 想「只在某会话」而不是「只在某预设」 | rc.6 没有 session-id 级 section API。用预设 scope；常驻会话固定绑 `friend-companion` |
| `defineTool` 以后改 DSL | 只改 compat 的 re-export；功能包继续只碰 `registerTool` |
| 必须在 host 全局注册的工具（例如调试） | 接受所有会话可见；**不要**再全局 `restrict` |

---

## 对 `dsh-compat.ts` 的影响

现有文件只实现了 `registerRoute`。W-M0-5 的另外五个封装按下面做。标注 **必须走兜底** 的，禁止假装去调一个本调研没见到的官方函数。

### 1. `registerPreset` — **必须走兜底**

- **不要**封装 `ctx.agentPresets.register`（不存在）。
- **不要**用 `copy()` 从 `standard` 复制再改 YAML（官方作者 API 不让你送组装文本；复制出来的是 user-trust 快照，升级不会跟着走）。
- **要做的**：
  1. 组装期投放 `presets/friend-companion/` 与 `presets/friend-companion-plus/`。
  2. 聚合 patch 把该父目录加进 `agent-presets.roots`（`trust: system`）。
  3. compat 导出 `registerPreset(ctx, { id })` = `await ctx.agentPresets.resolve(id)`，`broken` 则抛。这是启动断言，不是注册。
- 工具白名单写在预设包的 `apply(ctx)` 里：`restrictTools(ctx, { allow: COMPANION_ALLOWLIST })`。plus 是 companion 的超集。

### 2. `registerPromptSection` — 官方 API，原样包一层

- 实现：`return ctx.systemPrompt.section(section)`。
- 已是 fiber effect，**不要**再 `ctx.effect`。
- 调用点必须在预设常驻插件里，否则分区是全局的，编码会话也会吃到人格。
- JSDoc 写明官方符号：`ctx.systemPrompt.section`（`@deepseek-ai/dsh-system-prompt`）。替换预案：若 `section` 改名，只改 compat。

### 3. `registerTool` — 官方 API，原样包一层

- 实现：`return ctx.tools.register(definition)`；旁边 re-export `defineTool`。
- 同样不要二次 `effect`。
- `output: { schema, render }` 必填，compat 不必重新发明。
- 调用点同上：预设常驻 ctx。全局注册 = 所有会话都能看见该工具。
- 另导出 `restrictTools`（不算六封装之外的第七个「官方易变点」，但和预设白名单是一套）。

### 4. `registerRoute` — 已实现，小改即可

- 与 SDK 一致，保留 `ctx.effect(() => ctx.webServer.register(route), label)`。
- 建议：label 去掉虚假的 `GET`；assert 无尾斜杠。
- 调用方必须传 `kind: 'exact'`（`/friend/pet`、`/friend/events`、`/friend/tts/audio/:id` 这类——注意 webserver **没有** `:param` 匹配，带参数的路径要用 `prefix: '/friend/tts/audio'` 再自己 parse，或把 id 放 query）。
- **路径参数**：`WebRoute.path` 是字面量 exact/prefix，不是 Express 风格。`GET /friend/tts/audio/:id` 不能当 exact 注册。应用 `kind: 'prefix', path: '/friend/tts/audio'`，在 handler 里拆 pathname。

### 5. `pushToClient` — **必须走兜底**

- **不要**封装 `ctx.emit` + 指望 `host/remote-event`。
- **不要**往 `/api/events.host` 塞私有帧。
- **要做的**：内部调用 `registerRoute` 挂 `GET /friend/events` SSE，返回 `{ push, dispose }`。
- client 半区（可另文件，但连接建立要从 compat 出同一 event 名联合）用**一条** `EventSource('/friend/events')`，按 `event.type` 分发。
- JSDoc 写：官方封闭白名单见 `API_REMOTE_FORWARDED_EVENTS`；本封装是 SSE 兜底。若以后白名单可扩展或出现插件下行 API，只换这里的 `push` 实现。

### 6. `bindSettings` — 官方 API 两端都在；命名空间必须改

Host：

```341:341:/Volumes/WishDisk/codes/dsh-Friend/node_modules/@deepseek-ai/dsh-settings/lib/types/index.d.ts
export declare function installSettingsSection<T>(ctx: Context, ns: SettingsNamespace, schema: z<T>, entry: T, hooks: SettingsSectionHooks<T>): void;
```

`installSettingsSection` 已处理「有 settings 就 register + watch，没有就回退 composition entry」（`dsh-settings/lib/types/index.js` 656–685 行）。compat 的 host 端直接调它。

Client：

```89:99:/Volumes/WishDisk/codes/dsh-Friend/node_modules/.pnpm/@deepseek-ai+dsh-client-ui-settings@0.1.0-rc.6_@deepseek-ai+cordis@4.0.1_@deepseek-ai+d_05ef59874a88a63cf4628e3bf921c640/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/types/client/settings-scope.d.ts
    /**
     * Bind one namespace scope to settings and connection invalidations on the
     * CALLER's plugin lifecycle — ...
     */
    bind<T>(spec: SettingsScopeSpec<T>): SettingsScope<T>;
```

`SettingsScopeSpec` 的字段是 **`namespace`**（不是 migration-plan 写的 `{namespace}` 以外的别名）：

```38:47:/Volumes/WishDisk/codes/dsh-Friend/node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/contract/settings-scope.d.ts
export interface SettingsScopeSpec<T> {
    namespace: string;
    decode?: (section: unknown) => T | undefined;
}
```

**硬约束（迁移计划与 SDK 冲突）**：`settingsNamespace()` 只接受 `/^[a-z][a-z0-9-]*$/`（`dsh-settings/lib/types/index.js` 11–21 行）。**`friend.core` 这种带点号的名字会抛。** compat 必须改用 kebab，例如 `friend-core` / `friend-persona` / `friend-memory` / `friend-tts` / `friend-asr` / `friend-stage` / `friend-growth` / `friend-reactions` / `friend-pet`。

建议签名：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import {
  installSettingsSection,
  settingsNamespace,
  type SettingsSectionHooks,
} from '@deepseek-ai/dsh-settings'
import type { SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'

export function bindSettingsHost<T>(
  ctx: Context,
  ns: string,
  schema: z<T>,
  entry: T,
  hooks: SettingsSectionHooks<T>,
): void {
  installSettingsSection(ctx, settingsNamespace(ns), schema, entry, hooks)
}

export interface FriendSettingsScopeBinder {
  bind<T>(spec: SettingsScopeSpec<T>): SettingsScope<T>
}

export function bindSettingsClient<T>(
  settingsScope: FriendSettingsScopeBinder,
  spec: SettingsScopeSpec<T>,
): SettingsScope<T> {
  return settingsScope.bind(spec)
}
```

host / client 不能进同一个运行时模块（client bundle 纯度）。compat 可以按入口拆，或同一文件但 client 只 import type + 自己那一支函数；实现 W-M0-5 时再定模块切分，本调研只钉 API 形态。

---

## 附录：本调研明确没有找到的东西

这些不是失败，是 rc.6 的真实缺口，留给 compat 走兜底：

| 想找的 API | 结果 |
|---|---|
| `ctx.agentPresets.register` / `registerPreset` | 未在 rc.6 SDK 中找到 |
| 按 `presetId` 参数过滤的 `registerTool` / `section` | 未找到；过滤 = 调用方 scope |
| 整页 / 路由 client 槽（`app.page`、`route`、`fullscreen`） | 未找到 |
| `settings.plugin.item` | 未找到（计划用词过时） |
| 插件可写的 host→client 推送 / 可扩展 `API_REMOTE_FORWARDED_EVENTS` | 未找到 |
| 官方 MCP 插件包（旧 WBS 第 5 问） | 本任务改为提示词/工具；已安装 `@deepseek-ai/*` 树中也未见 `dsh-mcp*` 包。time 接线仍按迁移计划：官方 MCP 或 `defineTool` 自实现 `get_current_time`。 |

旧文档纠错（避免下一个工程师按过时名字实现）：

- `ctx.systemPrompt.section()` — **属实**。
- Agent Preset 作用域链 — **属实**；但注册方式是目录，不是函数。
- `ctx.tools.register()` / `defineTool` — **属实**。
- `installSettingsSection` + `settingsScope.bind` — **属实**；bind 的字段是 `{ namespace }`；ns 不能带点。
- `settings.plugin.item` — **不属实**，改为 `settings.section` / `settings.general.item` / `settings.plugins.tab`。
- 官方推送 seam — **对 Friend 业务事件不存在**；SSE 兜底成立，且 `WebRoute` 明文支持。
