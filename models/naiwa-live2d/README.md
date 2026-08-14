# Naiwa Live2D 模型素材包

这是基于 `Diyeego/naiwa-pet` 仓库中的奶蛙素材整理的 Live2D 编辑源文件目录。主角色采用上游的 `naiwa/naiwa2.png`：它是仓库中尺寸最大、包含完整正面姿态的奶蛙图。

## 目录

- `source/`：上游仓库原始 PNG 备份，仅作素材来源留档。
- `layers/`：为 Cubism 分层准备的透明 PNG 图层：身体底层、前后手臂、眼睛和嘴部。
- `export/`：Cubism 导出的 `.cmo3`、`.moc3`、`.model3.json`、纹理、物理和动作文件放在这里。
- `preview/`：导出后用于检查姿态和表情的预览图。
- `layers-v2/`：重新生成并校正交叉手臂后的第二版透明 PNG；不会覆盖第一版素材。
- `preview-v2/`：第二版中性姿态的静态合成验收图。
- `REBUILD-V2.md`：第二版素材、Photopea 分层与 Cubism 替换的完整操作说明。

## 计划绑定

模型会在 Cubism 中绑定头部/身体轻微摆动、呼吸、眼睛开合、嘴型和嘴巴开合，并以动作/表情预设提供：Idle、笑、尴尬、难过、惊讶、平静、生气。`EYES_CLOSED` 与 `MOUTH_SURPRISE` 初始隐藏，作为眨眼和惊讶表情的替换图层。

建议的参数命名：`ParamAngleX`、`ParamAngleY`、`ParamAngleZ`、`ParamBodyAngleX`、`ParamBreath`、`ParamEyeLOpen`、`ParamEyeROpen`、`ParamMouthOpenY`、`ParamMouthForm`、`ParamCheek`。动作预设只改变这些参数和替换图层的可见度，不依赖外部脚本。

## 来源与许可

- 素材来源：[Diyeego/naiwa-pet](https://github.com/Diyeego/naiwa-pet/)。请保留上游仓库的署名和 README 中的使用说明。
- 本目录中的分层修复图是为了将上游扁平 PNG 制作为 Live2D 编辑素材；不包含上游仓库没有提供的 `.cmo3` 或 `.moc3` 源文件。
- Live2D 模型的编辑与导出使用官方 Cubism Editor，并遵守其许可条款。
