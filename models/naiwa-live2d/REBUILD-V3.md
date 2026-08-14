# Naiwa Live2D V3 重制与制作指南

## 1. V3 的目标与结论

V3 以用户提供的参考图
`/Volumes/WishDisk/奶龙/oozBEeIgjgZ7GeAQAWKIA3FOhJILItMYTec5AE~tplv-dy-aweme-images-ds-rs-v1_1220_1550_q80.jpeg`
为唯一造型标准，重新生成了完整角色和七个 Live2D 图层。

本版重点修复旧稿的“左右胳膊重复/镜像”问题：

- 画面左侧手臂：自然下垂，深色手掌靠近胯部。
- 画面右侧手臂：屈肘向内，深色手掌位于腹部前方。
- 两条手臂的长度、弯曲方向、轮廓和手掌姿态均不同，不是镜像复制。
- 保留参考图的三分之四侧身视角、奶油色腹部和两条分开的长腿。

V3 是 `1220 × 1550` 的新画布、新视角和新肢体拓扑。不要直接把它替换进旧 V1/V2 的网格和变形器；建议从 V3 PSD 新建一个 Cubism 模型。

## 2. 交付文件

所有 PNG 都是 `1220 × 1550`、RGBA、透明背景。

| Cubism 图层名 | 文件 | 实际内容 |
|---|---|---|
| `01_BODY_BACK` | `layers-v3/body-back-v3.png` | 无手臂、无五官的身体、腹部与双腿 |
| `02_ARM_BACK` | `layers-v3/arm-back-v3.png` | 画面左侧自然下垂的手臂和手掌 |
| `03_ARM_FRONT` | `layers-v3/arm-front-v3.png` | 画面右侧屈肘内收的手臂和手掌 |
| `04_EYES_NEUTRAL` | `layers-v3/eyes-neutral-v3.png` | 睁眼状态 |
| `05_EYES_CLOSED` | `layers-v3/eyes-closed-v3.png` | 闭眼状态 |
| `06_MOUTH_SMILE` | `layers-v3/mouth-smile-v3.png` | 默认微笑 |
| `07_MOUTH_SURPRISE` | `layers-v3/mouth-surprise-v3.png` | 惊讶 O 型嘴 |

语义清晰的手臂文件也保留了一份：

- `layers-v3/arm-left-down-v3.png`
- `layers-v3/arm-right-bent-v3.png`

其他文件：

- `layers-v3/naiwa-master-v3.png`：完整角色母版。
- `preview-v3/naiwa-neutral-v3.png`：七层静态合成验收图。
- `preview-v3/naiwa-v3-reference-comparison.png`：参考图与 V3 并排对照图。

## 3. 素材生成方式

本版使用 Codex 内置 ImageGen，以参考图生成完整 V3 母版，再以该母版为唯一坐标基准逐层提取。生成器不能稳定直接输出真实 Alpha，所以每层先使用纯洋红 `#FF00FF` 背景，再通过色键转换为透明 RGBA。

### 3.1 完整母版提示词

```text
Use case: identity-preserve
Asset type: authoritative neutral master image for a Live2D model
Input image: the sole visual standard. Preserve this exact Naiwa character
identity, asymmetric pose, proportions, colors and soft 3D rendering.
Primary request: recreate a clean production-ready full-body portrait of the
same character in the same three-quarter view. The viewer-left arm hangs
naturally downward with its dark brown hand near the hip. The viewer-right arm
is distinctly different: bent at the elbow with the forearm angled inward and
its dark brown rounded hand near the lower belly. Preserve the two separate
long legs, large cream belly, tall rounded yellow head, green eyes and small
smile.
Composition/framing: vertical portrait, entire head, both arms, both hands,
torso and both legs visible with comfortable margin; centered similarly to the
reference; do not crop feet or head.
Style/medium: same simple soft low-poly 3D mascot render, gentle warm
yellow-to-orange shading, cream belly, smooth surfaces.
Scene/backdrop: one perfectly uniform pure magenta #FF00FF background with no
pattern, gradient, shadow, floor or reflection.
Constraints: exactly two non-identical arms; exactly two hands; left arm
straight/down, right arm bent/inward; preserve three-quarter view; no crossed
arms; no mirrored duplicate limbs; no text; no watermark; no extra objects.
Avoid: front-facing symmetrical pose, duplicated arms, duplicated hands,
crossed arms, giant forearms, checkerboard background, white background, cast
shadow.
```

### 3.2 图层提取的统一约束

每个图层单独生成一次，并在提示词中加入：

```text
Treat the supplied V3 master image as the exact edit target and coordinate
reference. Preserve the full portrait canvas and exact coordinates. Keep only
the requested component. Replace every other pixel with perfectly uniform
pure magenta #FF00FF. Do not move, resize, recenter, rotate, mirror, redraw or
crop the target component or canvas.
```

两条手臂分别指定：

```text
Viewer-left layer: keep only the long naturally hanging yellow arm and its dark
brown hand near the hip. Exactly one arm and one hand.

Viewer-right layer: keep only the yellow arm bent at the elbow and angled
inward/downward, plus its dark brown hand near the lower belly. Exactly one
bent arm and one hand.
```

身体层指定删除两条手臂、两只手、眼睛和嘴，并补回被手臂遮挡的少量肩部/侧身表面。眼睛和嘴则分别提取睁眼、闭眼、微笑和 O 型嘴。

### 3.3 透明通道处理

最终统一缩放到 `1220 × 1550`，然后执行：

```bash
ffmpeg -i generated.png \
  -vf "scale=1220:1550:flags=lanczos,colorkey=0xFF00FF:0.42:0.01,format=rgba" \
  -frames:v 1 output.png
```

如果边缘残留紫色，可把相似度从 `0.42` 提高到 `0.46`；如果黄色轮廓被侵蚀，则降低到 `0.36～0.40`。

## 4. 在 Photopea 中制作 V3 PSD

### 4.1 新建画布并导入

1. 打开 Photopea，选择 `文件 → 新建`。
2. 设置宽 `1220`、高 `1550`、RGB、透明背景。
3. 依次选择 `文件 → 打开并置入`，导入七张 V3 PNG。
4. 每一层都必须保持：
   - X：`0`
   - Y：`0`
   - 宽：`1220`
   - 高：`1550`
   - 旋转：`0°`
5. 右键每个置入图层，选择“栅格化”。不要保留智能对象、链接文件、图层蒙版或图层样式。

### 4.2 命名、分组与顺序

创建文件夹 `NaiwaV3`，将七个图层放入其中。图层从上到下排列为：

```text
03_ARM_FRONT
07_MOUTH_SURPRISE
06_MOUTH_SMILE
05_EYES_CLOSED
04_EYES_NEUTRAL
02_ARM_BACK
01_BODY_BACK
```

默认可见性：

- 显示：`01_BODY_BACK`、`02_ARM_BACK`、`03_ARM_FRONT`、`04_EYES_NEUTRAL`、`06_MOUTH_SMILE`
- 隐藏：`05_EYES_CLOSED`、`07_MOUTH_SURPRISE`

检查合成效果应与 `preview-v3/naiwa-neutral-v3.png` 基本一致，然后保存为：

```text
models/naiwa-live2d/layers-v3/naiwa-live2d-v3-source.psd
```

导出前确认：RGB 8 位、sRGB、普通像素图层、所有图层尺寸一致、透明背景。

### 4.3 Cubism 5.3 兼容版

Cubism 5.3.03 在 macOS 上无法稳定解析 Photopea 写出的图层记录，表现为点击打开后画布无变化，日志出现
`ArrayIndexOutOfBoundsException`。本项目保留 Photopea 组装源文件，同时用已验证的旧版 PSD 图层记录方言重新封装
同一批 V3 RGBA 像素。Cubism 中应打开：

```text
models/naiwa-live2d/layers-v3/naiwa-live2d-v3-cubism-ordered.psd
```

不要再选择 `naiwa-live2d-v3-source.psd` 或两个 `backup.psd`。兼容文件可通过
`tools/build_cubism_psd_from_pngs.py` 从七张 V3 PNG 重复生成。

## 5. 在 Cubism 5.3 中创建新模型

### 5.1 导入与部件

1. 选择 `文件 → 打开文件...`，打开 `layers-v3/naiwa-live2d-v3-cubism-ordered.psd`。
2. 如果出现“模型设置”，选择“新建模型”。V3 不要选择替换旧模型。
3. 导入后确认有 7 个 ArtMesh。
4. 如果 PSD 文件夹没有自动成为部件，在“部件”面板创建：
   - 名称：`NaiwaV3`
   - ID：`PartNaiwaV3`
5. 将七个 ArtMesh 全部拖入该部件。
6. 保存编辑文件：

```text
models/naiwa-live2d/export/naiwa-live2d-v3.cmo3
```

### 5.2 绘制顺序

建议设置：

```text
01_BODY_BACK        500
02_ARM_BACK         520
04_EYES_NEUTRAL     560
05_EYES_CLOSED      570
06_MOUTH_SMILE      580
07_MOUTH_SURPRISE   590
03_ARM_FRONT        620
```

`02_ARM_BACK` 和 `03_ARM_FRONT` 是为了兼容旧命名；本版实际含义分别是左侧下垂手臂和右侧屈肘手臂。

### 5.3 自动网格

逐类生成，不要七层一起使用同一种密度：

- `01_BODY_BACK`：自动网格“变形/标准”，中等密度；肩部、腹部边缘和腿根需要更多顶点。
- 两条手臂：自动网格“变形”，中高密度；肘部和手腕必须有连续顶点环。
- 睁眼、闭眼、嘴：标准或较细密度；轮廓外保留少量透明边界。

生成后逐层进入网格编辑模式，删除远离有效像素的多余三角形。不要让右臂网格跨到左臂，也不要将两条手臂合并成一个 ArtMesh。

### 5.4 变形器结构

建议结构：

```text
Warp_Root_NaiwaV3
└── Warp_Body
    ├── 01_BODY_BACK
    ├── Warp_Face
    │   ├── 04_EYES_NEUTRAL
    │   ├── 05_EYES_CLOSED
    │   ├── 06_MOUTH_SMILE
    │   └── 07_MOUTH_SURPRISE
    ├── Rotate_Arm_Left_Down
    │   └── 02_ARM_BACK
    └── Rotate_Arm_Right_Bent
        └── 03_ARM_FRONT
```

根弯曲变形器建议 `3 × 3` 或 `4 × 4`；右臂的旋转中心放在肩关节，左臂旋转中心也放在肩部，不要放在画布中心。

## 6. 参数绑定

### 6.1 推荐参数

| 参数 | 范围 | 用途 |
|---|---:|---|
| `ParamAngleX` | `-10 ～ 10` | 轻微左右视差；素材本身已经是三分之四视角 |
| `ParamAngleY` | `-8 ～ 8` | 轻微上下点头 |
| `ParamAngleZ` | `-10 ～ 10` | 侧倾 |
| `ParamBodyAngleX` | `-10 ～ 10` | 身体摆动 |
| `ParamBreath` | `0 ～ 1` | 腹部呼吸 |
| `ParamEyeBlink` | `0 ～ 1` | 双眼同步开合 |
| `ParamMouthOpenY` | `0 ～ 1` | 微笑与惊讶嘴切换 |
| `ParamMouthForm` | `-1 ～ 1` | 后续扩展嘴型 |

V3 目前把两只眼睛合在同一个 PNG 中，因此推荐一个同步眨眼参数 `ParamEyeBlink`。如果一定要独立左右眨眼，需要先把睁眼和闭眼素材各拆成左右两个 ArtMesh。

### 6.2 眨眼

为两层在 `ParamEyeBlink` 上添加 `0` 和 `1` 两个关键点：

```text
ParamEyeBlink = 1：EYES_NEUTRAL 100%，EYES_CLOSED 0%
ParamEyeBlink = 0：EYES_NEUTRAL 0%，EYES_CLOSED 100%
```

不要通过压扁睁眼网格来模拟闭眼；直接做不透明度交叉淡化更稳定。

### 6.3 嘴巴

```text
ParamMouthOpenY = 0：MOUTH_SMILE 100%，MOUTH_SURPRISE 0%
ParamMouthOpenY = 1：MOUTH_SMILE 0%，MOUTH_SURPRISE 100%
```

如果切换中间出现双重嘴，将 `0.45～0.55` 区间做更快的交叉切换，或在 Expression 中直接设为阶跃式显示。

### 6.4 呼吸与摆动

- `ParamBreath = 0`：默认形状。
- `ParamBreath = 1`：腹部横向扩大约 `1%～1.5%`，上移不超过 `4～6 px`。
- 两条手臂随腹部仅移动 `2～4 px`，不要改变左右手臂的基础姿态。
- `ParamBodyAngleX = ±10` 时，根变形器左右移动约 `6～10 px`，左右手臂旋转不超过 `2°～3°`。
- 因为素材已经是固定三分之四视角，不要用 `ParamAngleX` 强行做大角度左右转头。

## 7. 制作 4 秒 Idle 动作

1. 切换到“动画”工作区，新建场景 `Idle`。
2. 设置 `30 fps`、时长 `4 秒`、循环播放。
3. 添加关键帧：

```text
时间       0s    1s    2s    3s    4s
Breath     0     0.5   1     0.5   0
BodyX      0     2     0    -2     0
AngleZ     0     1.2   0    -1.2   0
```

4. 曲线使用平滑贝塞尔，不要使用线性折线。
5. 左臂摆幅小于右臂；右臂手掌贴近腹部，避免摆动时穿入腹部。
6. 自动眨眼建议交给运行时 EyeBlink；如果必须烘焙，可在约 `1.6s` 和 `3.4s` 各加入一次 `0.12～0.18s` 的闭眼。

## 8. 纹理集与导出

1. 选择 `建模 → 纹理 → 编辑纹理集...`。
2. 新建 `4096 × 4096` 纹理，选择高质量自动排版。
3. 确认七个 ArtMesh 都已排版，透明区域没有被当作整张实色图片。
4. 如果仍只看到蓝色/青色矩形，先取消导出，回 Photopea 检查图层是否已经栅格化、是否含真实 Alpha、是否还存在黑色蒙版或链接智能对象。
5. 保存 `.cmo3` 后选择 `文件 → 导出运行时文件 → 导出为 moc3 文件...`。
6. 勾选导出隐藏 ArtMesh，避免闭眼和惊讶嘴丢失。

建议最终目录：

```text
models/naiwa-live2d/export-v3/
├── naiwa-live2d-v3.cmo3
├── naiwa-live2d-v3.moc3
├── naiwa-live2d-v3.model3.json
├── textures/
├── motions/
│   └── idle.motion3.json
└── expressions/
    ├── calm.exp3.json
    └── surprise.exp3.json
```

最后用 Cubism Viewer 打开 `naiwa-live2d-v3.model3.json`，依次测试：默认站姿、Idle、眨眼、微笑/惊讶切换、身体左右摆动。重点检查右臂手掌不穿入腹部，以及左臂不会被误显示成右臂的镜像副本。

## 9. 当前素材边界

V3 已从静态素材层面解决重复胳膊问题，并明显靠近参考图的姿态和比例。但它仍是依据单张参考图重新渲染的 2D 分层素材，不是原始 3D 工程导出的隐藏面。大幅转身、手臂抬起或独立左右眨眼，需要额外绘制隐藏肩部、手臂背面和左右独立眼睛图层。
