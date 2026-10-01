# 富士山下的无人罗森 · Web 3D

当前里程碑已经接入完整 V12 商店、第一人称移动和全量商品交互。

## 当前范围

- 3880 个商品实例、1724 个陈列位、846 个 SKU，覆盖 12 个陈列区。
- 前排商品可拿起、自由拖动旋转、放回货架或加入购物篮。
- 拿起查看使用独立深度层，不受货架遮挡；商品自身仍保留正常前后遮挡。
- 拿起、放回与收进购物篮有短过渡；系统“减少动态效果”设置会简化动画。
- C1/C4 的八扇冰箱门支持点击开关，也可在提示出现时按 E；关门不能隔玻璃取货，门扇与玩家有避让及行走碰撞。
- 拿走前排后，后排商品变为可拿取状态。
- 商品按材质合并为批量渲染，但仍保留逐件射线拾取和业务数据。
- 店外可环绕观察；进入商店时镜头从正门平滑穿入，建筑保持完整。
- 店内支持 WASD/方向键移动、拖动环顾，以及商店边界和六组中央货架的碰撞阻挡。
- 静态店体、外屋顶和货架商品独立加载；GLB 合计约 32 MiB。
- 货架共用正反面 256px 图集，靠近与拿起时按需加载更高清的正反面 WebP。

## 本地运行

```bash
pnpm install
pnpm dev
```

打开 `http://127.0.0.1:5173/`。

仓库已包含 `public/` 中的打包模型和商品贴图，克隆后即可运行，不需要 Blender 或外部 `art/` 目录。

## 检查

```bash
pnpm test
pnpm test:assets
pnpm build
```

## 资产管线

以下是可选的建模工作区工具，需要仓库外的 `../art/` 源资源和 Blender；原始 `.blend`、中间文件和历史备份不随 Web 仓库发布。

当前导出源是 `lawson-complete-v12-optimized-closeup-v9.blend`，保留 V6–V8 原件。
导出时源文件保持只读，每个对象先固化自身修改器再合并；场景 Meshopt 压缩保留浮点位置和法线，商品仅量化位置/UV。
需要重新导出时：

```bash
pnpm assets:closeups
/Applications/Blender.app/Contents/MacOS/Blender \
  --background \
  --python tools/blender/export_full_store.py
pnpm assets:optimize -- v02
```

- 原始中间文件：`../art/web-export-v02/raw/`
- 导出运行文件：`../art/web-export-v02/runtime/`，重新导出后同步到本仓库 `public/`
- 页面使用的按需贴图：`public/product-textures/`
- 导出清单：`../art/web-export-v02/manifest.json`

本轮修复与原始资源备份位于 `../art/web-surface-repair-20261001/`。
冷柜凹槽、六种圆碗细化及虾仁饭穿模修复、V7 资源备份位于 `../art/web-cold-meal-repair-20261001/`；对应验证脚本为 `tools/blender/verify_cold_meal.py`。
V9 对 28 种商品的颜色重叠面进行平面裁切；审计、修复记录和 V8 资源备份位于 `../art/web-interaction-repair-20261001/`。八扇门保留在场景 GLB 中的独立门轴节点，不再合并进静态柜体。自动检查并不代表全量商品逐角度视觉验收。
导出器回归测试：`Blender --background --python tools/blender/test_export_modifiers.py`。
当前包含 3268 张 WebP（817 种商品的正反面、两档清晰度），按需加载以避免一次性解码全部图片。KTX2/Basis GPU 纹理压缩、实际视锥/区域卸载和移动设备验收仍是后续性能硬门槛。
