# 人脸账户关联交付与验证

日期：2026-10-09。任务：AIRI-034。范围：Web 舞台、本地会话、普通聊天与快慢脑身份。

## 交付行为

确认人物后，右上角显示其姓名并进入人物 ID 对应的本地会话。
离开、多人、纠错、未确认身份、撤权、停止采集或画面过期后回到陌生人。
换人切换会话，重遇恢复自己的记录。姓名修改不创建第二个聊天分区。
会话切换保留同一次摄像头采集，避免识别和退出循环。

普通模型、快脑与慢脑使用同一即时身份。换人取消旧生成和音频，转写归属使用人物账户键。
主动语音以轨迹与账户共同区分相遇，现有配置和宿主可用时重新接管新账户。
短租期最多两秒，同一人物的同步续期最多每秒一次。
本地身份不创建云用户、令牌或额度，不进入云会话同步，不授予开发者权限。

## 验证证据

验证使用原生浏览器、Canvas 采集、本机视觉传输夹具与生成人物数据。
模型、麦克风和语音服务采用现有测试边界。本机原生 WebSocket 验证会话连接拥有权。
浏览器测试数据与视觉夹具在场景开始时清理，避免先前运行的档案和历史污染结果。

| 检查 | 实际结果 | 证据与限制 |
| --- | --- | --- |
| 8个目标测试文件 | 89项通过，退出0 | 原生浏览器和本机测试夹具，不是实际模型或真人 |
| 根级`pnpm typecheck` | 55/55工作区任务成功，退出0 | 覆盖共享层与Web/Electron/Pocket类型，不证明各端摄像头宿主 |
| 根级`pnpm lint` | 退出0，0错误、603既有警告 | 使用既有`RAYON_NUM_THREADS=1`运行方式，未禁用规则 |
| `@proj-airi/i18n build` | 退出0 | 英文与简体中文账户标签重建 |
| `@proj-airi/stage-web build` | 退出0 | 舞台生产构建与PWA生成，既有插件/资源警告保留 |

从工作区初始化环境后，在`airi`目录执行：

```powershell
. ../scripts/airi-env.ps1
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $AiriWorkspace '.tools/playwright'
& $AiriNode ./node_modules/vitest/vitest.mjs run --config packages/stage-ui/vitest.config.ts src/stores/stage-identity.browser.test.ts src/stores/companion.browser.test.ts src/stores/local-vision.browser.test.ts src/stores/chat/context-providers/user-account.browser.test.ts src/stores/chat/session-store.browser.test.ts src/stores/modules/realtime-brain.browser.test.ts src/stores/chat.contract.test.ts src/stores/chat/voice-transcript.browser.test.ts --no-file-parallelism
& $AiriNode $AiriPnpm --config.verify-deps-before-run=false typecheck
$env:RAYON_NUM_THREADS = '1'
& $AiriNode $AiriPnpm --config.verify-deps-before-run=false lint
& $AiriNode $AiriPnpm --config.verify-deps-before-run=false -F @proj-airi/i18n build
& $AiriNode $AiriPnpm --config.verify-deps-before-run=false -F @proj-airi/stage-web build
```

日志位于工作区`.runtime/face-account-tests.log`、`face-account-root-typecheck.log`、`face-account-lint.log`和`face-account-web-build.log`。
已有依赖未改变，采用开发指南的依赖校验参数，未重新安装。
首次完整lint输出0错误后原生进程以`3221225477`退出，限制线程后完整重跑退出0。
测试日志包含取消、测试组件拆除和云夹具断线诊断，没有未处理测试错误。

新增身份测试验证：单人确认、换人、离开、再次恢复、同人物改名、多人、姓名纠错、权限撤回、断帧过期与多窗口租期。
采集启动次数和binding在账户切换中保持不变。会话同步测试改为真实Pinia与本机原生WebSocket，并增加人物账户隔离用例。
主动语音对照验证普通输入开关两种状态、手动挂断不重连，以及同一轨迹从陌生人到确认人物后使用新姓名和新会话接管。

Wiki指纹复核、`project-wiki.mjs check`与`generate-project-index.mjs`结果记录在AIRI-034任务。

## 使用与现场验收

Web舞台保持主动模式，并开启人脸、姓名和观察权限。已有确认档案识别成功后自动显示其姓名。
未建档人物继续走现有自然介绍、本人姓名确认和采样流程。顶部姓名入口连接视觉设置。
让已知人物单独入镜、离开、另一人物进入、原人物回来，核对顶部姓名、各自历史和旧语音停止。
改名通过原确认流程，不能仅凭聊天中随口称呼创建另一个人物账户。

## 未验收边界

没有读取或改写真实人物数据库，没有导出真人照片、姓名或模板。
没有进行真人物理进出、长期误认和实际模型回答验收。
已有未配置的模型服务、LAN 设备和其他客户端宿主不因本轮自动测试完成。
本地身份隔离不隐藏设备所有者可访问的 IndexedDB，也不增加跨设备同步。
