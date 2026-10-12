# 实际验证记录

日期：2026-09-29。源码基线：`main@2e0e963670e5435a2909149fff1f83b93f8ffd11`。
改动保留在当前工作目录，未创建远端提交或 PR。

## 已执行

| 命令 / 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| `scripts/vision.ps1 test` | 18 项通过，包括真实 Windows DPAPI、删除、校准失效、帧限额和服务鉴权 | `unit-tests.actual.json` |
| `pnpm -F @proj-airi/local-vision test:run` | 9 项通过，投影隐私、时效、来源和问候冷却 | `policy-tests.actual.json` |
| Stage UI node：`use-vision-inference.test.ts`、`chat.contract.test.ts`、`wire-message.test.ts` | 50 项通过，包括当前请求临时投影和派生回复排除 | 工作区 `.runtime/vision-chat-tests.log` |
| Stage UI browser：`local-vision-capture.browser.test.ts` | 3 项通过，使用真实浏览器与画布流，无真实摄像头 | `.runtime/vision-capture-tests.log` |
| Stage UI browser：`user-account`、`voice-transcript`、`realtime-audio` | 6 项通过 | `.runtime/vision-baseline.log` |
| `pnpm -F @proj-airi/pipelines-audio exec vitest run src/speech-pipeline.test.ts` | 5 项通过 | `.runtime/vision-speech-tests.log` |
| `scripts/vision.ps1 smoke` | 五个真实模型执行成功；YOLOX 分析记录显示 203 个 CUDA 节点 | `model-smoke.actual.json` |
| `scripts/vision.ps1 integration` | 真实 HTTP / WebSocket / JPEG / 模型链路通过，发送五帧合成灰图 | `service-integration.actual.json` |
| 集成脚本中的网关安全检查 | 缺专用头、错误 Origin 被拒；凭据和人员库六种 Vite 文件读取路径均被拒 | `service-integration.actual.json` |
| `pnpm typecheck` | 55 个工作区任务通过 | `.runtime/vision-root-types.log` |
| `pnpm build:web` | 26 个构建任务通过 | `.runtime/vision-build-web.log` |
| `pnpm -F @proj-airi/i18n build` | 中英文文案包构建通过 | `.runtime/vision-build-i18n.log` |
| `pnpm lint` | 退出 0，0 错误，605 个既有警告 | `.runtime/vision-lint.log` |
| `git diff --check` | 退出 0，仅有仓库换行转换提示 | 命令输出 |
| 本地浏览器检查 | 中文正式入口可打开，显示 cuda，权限关闭，未配置项目明确提示 | `vision-settings.png` |
| `scripts/vision.ps1 accept --profile engineering` | 预期退出 1，NOT_ACCEPTED | `acceptance.actual.json`、`acceptance.html` |

自动化测试合计 91 项通过；这个数字不代表原规范 82 项完整场景全部通过。
窗口检查发生在非主窗口，摄像头按钮按拥有者规则禁用；未通过自动化绕过此限制。

## 实测问题与修复

- OpenCV 在 Windows 中文路径下读取权重失败，已改用内存模型缓冲区并完成五模型实测。
- 初次 YOLOX 下载中断，已加入长度检查、断点续传和 ONNX 解析，重新获取有效权重。
- CUDA 曾在第一次执行时退回 CPU。已补充 NVIDIA DLL 搜索路径，并用实际节点 provider 确认修复。
- 测试数组曾被格式规则改写成 `unknown[]`，已修复并重跑根级类型检查。
- 局部 ESLint 自动修复曾异常退出；完整 `pnpm lint` 重跑正常退出。

## 未验证与限制

没有本轮真实摄像头测试授权，未启用真人摄像头、登记真人或采集任何照片。
没有独立的授权身份/动作数据，没有执行校准、准确率、困难场景或照片重放质量评估。
没有配置真实视觉 API，没有调用付费看图，没有验证真实单图、多图和 50 题人工质量。
Grounding DINO 适配和准备命令已提供，但本机扩展依赖和权重尚未准备，真实找物未验证。
没有执行完整 15 分钟性能基线、角色帧率对比或 8 小时稳定性。
Electron、手机、LAN 摄像头和自动断线重连未交付。

因此交付状态是“基础适配已实现并完成上述验证”。不能标记 ENGINEERING_READY 或 FULL_ACCEPTED。
测试矩阵的缺失证据保留在验收报告中。后续验证不得用合成灰图、mock 或重复同一素材代替真人质量证据。

## 数据与重现

模型 SHA 和许可记录在 `models-lock.actual.json`。许可审查仍为 REVIEW_REQUIRED。
环境在 `environment.actual.json`。精确 Python 依赖在服务目录 `requirements.windows.lock.txt`。
模板、原权重和控制凭据都保留在忽略目录，不进入上述报告。
启动和校准说明见工作区 `开发文档/07-local-vision.md`。
