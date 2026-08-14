# Naiwa Live2D V2 素材重制指南

## 1. 本次产物

V2 素材位于 `layers-v2/`，旧的 `layers/` 没有被覆盖。

| Cubism 图层名 | V2 PNG |
|---|---|
| `01_BODY_BACK` | `layers-v2/body-back-v2.png` |
| `02_ARM_BACK` | `layers-v2/arm-back-v2.png` |
| `03_ARM_FRONT` | `layers-v2/arm-front-v2.png` |
| `04_EYES_NEUTRAL` | `layers-v2/eyes-neutral-v2.png` |
| `05_EYES_CLOSED` | `layers-v2/eyes-closed-v2.png` |
| `06_MOUTH_SMILE` | `layers-v2/mouth-smile-v2.png` |
| `07_MOUTH_SURPRISE` | `layers-v2/mouth-surprise-v2.png` |

静态合成预览：

`preview-v2/naiwa-neutral-v2.png`

全部 PNG 均为 `1192 x 1231`。身体采用原比例修复层；两条手臂重新生成、抠像、镜像、移位并旋转，使肘部分居左右、前臂在胸前交叉。第一轮过大的手臂草稿没有作为最终文件使用。

## 2. 生成思路与最终提示词

使用内置图像生成工具编辑原图 `source/naiwa2.png`。因为生成器没有直接写出真实 Alpha，先要求纯洋红 `#FF00FF` 背景，再将洋红转换为透明通道。

### 下层手臂

```text
Treat naiwa2.png as the authoritative edit target. Keep only the complete
visible arm on the viewer-left side, including its yellow arm and attached
brown hand. Replace every other pixel with perfectly uniform #FF00FF.
Do not move, resize, recenter or restyle the retained arm. Preserve the
original full portrait canvas and coordinates. Output one arm only; no body,
second arm, duplicate hand, checkerboard, text or watermark.
```

### 上层手臂

```text
Treat naiwa2.png as the authoritative edit target. Keep only the complete
visible arm on the viewer-right side, including its yellow arm and attached
brown hand. Replace every other pixel with perfectly uniform #FF00FF.
Do not move, resize, recenter or restyle the retained arm. Preserve the
original full portrait canvas and coordinates. Output one arm only; no body,
second arm, duplicate hand, checkerboard, text or watermark.
```

上层手臂随后水平镜像，使左右手方向自然。两条手臂分别进行小幅移位和约 `9.2°` 的反向旋转，形成交叉。

## 3. 在 Photopea 中制作 V2 PSD

1. 打开 Photopea，选择 `文件 -> 新建`。
2. 画布设置为 `1192 x 1231`、RGB、透明背景。
3. 依次选择 `文件 -> 打开并置入`，导入 `layers-v2/` 中的七张 PNG。
4. 每张 PNG 都必须保持：
   - X 坐标 `0`
   - Y 坐标 `0`
   - 宽度 `1192`
   - 高度 `1231`
   - 缩放 `100%`
5. 将置入的智能对象全部右键选择“栅格化”。Cubism 最终需要普通像素图层。
6. 创建文件夹 `Naiwa`，把七层全部放入文件夹。
7. 从上到下设置图层顺序：

```text
03_ARM_FRONT
07_MOUTH_SURPRISE
06_MOUTH_SMILE
05_EYES_CLOSED
04_EYES_NEUTRAL
02_ARM_BACK
01_BODY_BACK
```

8. 重命名时必须完全使用上面的英文名称，不要附带 `-v2`。
9. 默认可见性：
   - `01_BODY_BACK`：显示
   - `02_ARM_BACK`：显示
   - `03_ARM_FRONT`：显示
   - `04_EYES_NEUTRAL`：显示
   - `05_EYES_CLOSED`：隐藏
   - `06_MOUTH_SMILE`：显示
   - `07_MOUTH_SURPRISE`：隐藏
10. 放大到 `200%` 检查手臂边缘。如果仍有一像素紫边，用图层蒙版配合 1～2 像素软橡皮擦清理，不要直接缩放图层。
11. 将手掌稍微藏入另一条前臂下面，只修改蒙版，不改变整条手臂的位置。
12. 导出为：

```text
layers-v2/naiwa-live2d-v2-source.psd
```

导出前确认：RGB 8 位、sRGB、普通像素图层、没有调整图层、没有图层样式、没有外部链接智能对象。

## 4. 静态合成验收

在进入 Cubism 前，必须先在 Photopea 中显示中性眼睛和微笑嘴：

- 头、眼睛和嘴的位置与 `source/naiwa2.png` 一致。
- 两个肘部分居左右，不存在覆盖整张胸口的单根横臂。
- 两只手都与各自前臂连接，不出现悬空手掌。
- 两条前臂在胸前交叉，交叉处只有一条清晰遮挡关系。
- 身体、手臂颜色接近，没有洋红、黑色或白色描边。
- 下半身没有被裁掉。

只有静态合成通过后才进入 Cubism。变形器无法修复静态素材比例问题。

## 5. 替换到当前 Cubism 模型

1. 先将当前模型另存为备份：

```text
export/naiwa-live2d-before-v2.cmo3
```

2. 打开当前 `export/naiwa-live2d.cmo3`。
3. 把 `naiwa-live2d-v2-source.psd` 拖入建模画布。
4. 在“模型设置”选择：

```text
向打开的模型添加或替换 PSD
```

5. 选择当前 `naiwa-live2d` 模型。
6. 在“重新导入设置”选择“替换已经加载的 PSD”，不要选择新增 ArtMesh。
7. 替换后确认仍然只有七个 ArtMesh，并且仍位于 `Naiwa` 部件下。
8. 选中 `02_ARM_BACK` 和 `03_ARM_FRONT`，分别执行：

```text
建模 -> 纹理 -> 自动网格生成 -> 变形（轻）
```

9. 如果旧网格仍沿用旧轮廓，先进入网格编辑模式执行“重置网格”，再自动生成。
10. 确认两条手臂的父级仍为 `Naiwa的弯曲变形器`；若父级丢失，将它们重新拖入该变形器。
11. 绘制顺序保持：

```text
01_BODY_BACK       530
02_ARM_BACK        550
04_EYES_NEUTRAL    560
05_EYES_CLOSED     570
06_MOUTH_SMILE     580
07_MOUTH_SURPRISE  606
03_ARM_FRONT       655
```

12. 检查已有 `ParamBodyAngleX`：`-10 / 0 / 10` 三个关键点均不能破图。
13. 因为手臂网格已更换，呼吸变形幅度控制在 3～5 像素；不要让交叉点明显滑开。
14. 保存为新版本：

```text
export/naiwa-live2d-v2.cmo3
```

## 6. 最终导出检查

1. 打开纹理集并重新自动排版。
2. 确认纹理预览是真实角色图像，不是蓝块。
3. 导出 MOC3 时勾选“导出隐藏的 ArtMesh”，否则闭眼和惊讶嘴可能丢失。
4. 用 Viewer 检查身体摆动、呼吸、眨眼和嘴巴切换。
5. 最终运行时文件建议使用 `naiwa-live2d-v2` 作为统一前缀，避免覆盖旧模型。

## 7. 当前 V2 的限制

V2 已解决最明显的巨型横臂、重复手掌和左右不平衡问题，但它仍是基于扁平原图生成的分层候选，不是原始 3D 工程导出的真实隐藏面。若要求与原图像素级一致，需要在 Photopea 中手工修补手掌遮挡处和肩部接缝；其余脸部图层可以继续沿用现有版本。
