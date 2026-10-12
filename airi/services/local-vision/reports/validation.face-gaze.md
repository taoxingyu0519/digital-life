# 2026-10-01 人脸驱动角色目光与头部

任务：AIRI-015。本机非商业、非盈利科研工作区。
Web 主舞台已用摄像头人脸替代鼠标目标，支持未认识的人，不新增模型或摄像头拥有者。

`face_bbox` 由 YuNet 现有检查产生。位置在身份判断和入库质量之外，不受确认后特征降频影响。
首选主目标，其次保留原轨迹，再选最大脸。镜像水平位置，时间平滑，过滤 0.8% 以下的小位移。
漏脸最多保留 250ms。画面年龄加往返延迟超过 500ms、权限撤销、模式关闭或来源变化会清空目标。
Live2D 通用动作模式驱动眼睛和头部。VRM 叠加水平 ±0.3、垂直 ±0.2 弧度的头部转动。
每帧先恢复动画姿态再叠加，避免逐帧累积。手工动作仍优先，其余渲染器未新增头部跟随。

## 本轮实际验证

Node 命令使用 `scripts/airi-env.ps1` 初始化的运行时与已有依赖。
pnpm 命令使用 `--config.verify-deps-before-run=false`，避免无关自动安装，未增加依赖。

| 位置与命令 | 结果 | 证据与方式 |
| --- | --- | --- |
| 工作区 `scripts/vision.ps1 test` | 47 项通过，退出 0 | `.runtime/gaze-python-tests.log`。真实 ByteTrack/数据库，外部模型替身。验证模糊陌生脸位置、全帧换算和失脸清空 |
| local-vision 包 `vitest run` | 16 项通过，退出 0 | `.runtime/gaze-policy-tests.log`。含五项目标、方向、平滑、保持、过期、权限与来源代际测试 |
| stage-ui-three 包 `vitest run src/composables/vrm/head-gaze.test.ts src/composables/eye-tracking.test.ts` | 4 项通过，退出 0 | `.runtime/gaze-head-tests.log`。真实 Three Object3D/Quaternion，连续 600 帧不积累、动画保持及失脸回正 |
| 根 `vitest run --config packages/stage-ui-live2d/vitest.node.config.ts`，限制到 eye-tracking/motion-manager 两文件 | 24 项通过，退出 0 | `.runtime/gaze-live2d-tests.log`。现有坐标与动作回归 |
| stage-ui 包 `vitest run --project browser`，限制到 companion/local-vision/local-vision-capture | 6 项通过，退出 0 | `.runtime/gaze-browser-tests.log`。真实 Pinia、Vue RAF、Chromium、Canvas MediaStream、LV01/WebSocket，外部推理 fixture |
| 根 `pnpm typecheck` | 55 任务成功，44 缓存，退出 0 | `.runtime/gaze-typecheck.log` |
| 根 `pnpm lint` | 0 错误、605 个既有警告，退出 0 | `.runtime/gaze-lint.log` |
| 根 `pnpm --filter @proj-airi/stage-web build` | 退出 0 | `.runtime/gaze-web-build.log`。既有打包与插件性能提示 |
| 工作区 `scripts/vision.ps1 integration` | 最新服务五帧通过，退出 0 | `.runtime/gaze-integration.log` 与 `service-integration.actual.json`。生成灰图、真实 CUDA、鉴权/拥有者/释放 |
| 工作区 `scripts/vision.ps1 recognition-probe` | 两次各60帧均输出合法人脸框，退出0 | `.runtime/gaze-real-face-probe.log` 与 `recognition-probe.actual.json`。真实YuNet/EdgeFace/ByteTrack、已有加密照片，仅人体框/时间由测试提供，不写档案或记忆 |
| airi 根 `git diff --check` | 退出 0 | `.runtime/gaze-diff-check.log` |
| 工作区 `scripts/generate-project-index.mjs` | 退出 0，72包、5515源码 | 现有Node、Git与机械索引 |

相关自动测试共 97 项通过。浏览器证明目标接线，推理替身不证明真人人脸模型质量。
已用现有脚本启动 Web、最新 Python 视觉与原 LAN HTTPS 入口。ready=true，device=cuda。
未录制或导出真人画面，未调用外部模型服务，也未改动真人姓名、照片和人物记忆。

## 笔记本现场待验收

用户刷新页面后，开启主动模式，测试左右上下移动、中心静止超过一秒、短遮挡、离开和被动切换。
真实方向、转头幅度、目光与头部延迟、移动布局、角色帧率仍由用户现场确认。
模型加载、自动测试和构建通过不等于真人现场验收。AIRI-009 保留该工作。

决策见 [ADR](../../../docs/ai/adr/2026-10-01-camera-face-gaze.md)。
