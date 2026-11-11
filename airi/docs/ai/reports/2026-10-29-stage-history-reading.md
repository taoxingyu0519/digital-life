# 主舞台漏记录修复与阅读调节

日期：2026-10-29。任务：AIRI-046。

## 结果与使用方式

主舞台现在显示通话中的实时字幕。字幕确认后以同一消息 ID 转为历史，避免等待播放结束期间看不到内容。
不同轮次可以保留相同的短回答。VAD 先于 ASR 开始时，每轮也使用独立且稳定的消息 ID。

桌面聊天标题栏和移动端顶部新增 **Aa** 按钮。可分别调整字号、气泡大小，或恢复默认。
正文默认 18px，可按 2px 步长调整到 14–30px。气泡有五档宽度和留白。
偏好保存在当前浏览器，刷新后保留。人物归档标签继续使用小字号。
查看旧记录时仍暂停自动跟随。新增“回到最新消息”按钮，点击后恢复跟随。

本轮不重建此前已经被覆盖或未落库、且没有原始来源的内容。

## 复现与原因

| 问题 | 原因与修复 | 复现证据 |
| --- | --- | --- |
| 两次正常回答相同短句，第二次文字消失 | 网关跨响应比较正文。改为按响应 ID 去重，每个新响应重置文本累计 | 新增三项网关用例，修复前失败，修复后通过 |
| VAD 有开始事件、ASR 缺少独立开始事件时，下一轮覆盖上一轮 | 输入话轮没有及时更新 ID。VAD 与 ASR 共用话轮入口，分开维护上游关联 ID 和稳定显示 ID | VAD 先行、最终包重复及连续话轮用例 |
| 通话正常，历史框迟迟没有正在说的内容 | 原字幕只在通话局部状态，历史组件只读已确认记录 | 新增真实 store 浏览器用例，确认前显示、音频完成后仅保留一条 |
| 阅读暂停后新消息在底部不可见 | 原自动跟随保护没有显式恢复入口 | 100 条生成历史、翻首尾与“回到最新消息”实页验证 |

豆包协议分别发送 ASR、文本和音频完成事件，不能把它们视为同一个完成边界。
参考：[豆包端到端实时语音官方协议](https://docs.volcengine.com/docs/doubao-voice/end-to-end-real-time-voice-full-duplex-version?lang=zh)。

## 数据与生命周期

`realtime-voice` store 保存本次通话的临时字幕，按会话、身份代际和通话代际过滤。
主舞台合并已保存记录与字幕，以 ID 替换而非追加重复项，并使用首次收到字幕的时间排序。
字幕仍属临时显示，不会提前进入确认事实或聊天档案。

用户最终转写沿原路径保存。智能体记录仍等待对应音频完成，打断的片段保留 interrupted 标记。
保存成功后移除对应字幕。存储失败保留现有错误状态和显示，停止通话时清理临时状态。
实时同步、逐条人物归档、稳定登录和关闭后的迟到事件隔离继续走原有规则。

字号和气泡使用独立本地设置，不进入跨设备模型配置或人物记忆。
字体重排时，正在跟随底部的窗口保持跟随，查看旧消息的窗口保持阅读位置。
重置显式写入 18px 和默认气泡档位，避免页面重载后把上次偏好当成默认值。

## 验证

专项验证：语音网关 17 项通过，实时快慢脑 54 项通过，阅读、历史、合并与滚动四文件 51 项通过。
历史组件原有 36 项浏览、手势和显示用例全部保留并通过。
较大字体的滚动断言改为按实际占位高度测量，保留尾部对齐约束。

真实页面使用 `http://127.0.0.1:4173`，隔离浏览器与生成消息，麦克风和语音上游传输为模拟边界：

- 部分字幕、最终转写、音频完成、相同回答重复和打断片段均可显示，确认后没有重复记录。
- 六条生成记录刷新后保持原会话和内容。字号、气泡可调、可刷新保留，也可恢复默认。
- 桌面 1280×1000 和移动端 390×844 均检查截图，无横向溢出。
- 独立的 100 条生成历史可访问首尾，虚拟列表实际仅挂载 10 行，“回到最新消息”可用。
- 实际舞台启动、关闭、设置→机体模块→长期记忆与开发者权限入口可访问，再启动恢复 CUDA ready。
- 页面验收的 `pageerror` 数为 0。证据：`.runtime/AIRI-046-ui.json`、`AIRI-046-ui.log` 和桌面/移动截图。

组件浏览器测试中，Vite 客户端输出过 `ResizeObserver loop completed with undelivered notifications`。
对应测试退出码为 0，未屏蔽该诊断。实际 100 条历史实页验收未捕获此错误，不能据此断言其具体原因。

完整交付门禁最终通过：14 步全部退出 0，自动测试合计 399 项。

| 实际命令或门禁步骤 | 结果 |
| --- | --- |
| `scripts/test-airi-delivery.ps1 -Task AIRI-046` | 14 步通过，`result.json` 的 `automaticPassed=true` |
| 根级 `pnpm run typecheck --concurrency=1` | 55 个任务成功 |
| 根级 `pnpm run lint --no-cache` | 退出 0，0 errors、603 warnings |
| critical-regression | 22 文件、229 项通过，保留身份、档案、会话、音频、采集和启停基线 |
| chat-runtime、gateway-contracts | 33 项、49 项通过 |
| stage-theme、shared-settings-host、vision-service | 1 项、6 项、81 项通过 |
| core/i18n/voice/vision 构建、Web 构建及 live-gateways | 通过，实际视觉 CUDA ready，语音配置连接正常 |

执行时使用 `scripts/airi-env.ps1` 初始化的 Node 和 pnpm。完整日志位于 `.runtime/delivery/AIRI-046/`。
前两次全量 lint 均输出 0 errors、603 warnings 后以 `-1073741819` 退出，已按失败保留记录。
限制原生线程池的单次探针退出 0，但随后完整运行仍失败，不能将它视为已解决。
最终使用 Node 默认堆和原生线程池限制执行相同范围，lint 与完整门禁均正常退出。
这证明本次运行通过，不证明崩溃根因已经查明或所有后续运行都稳定。
失败证据另外保存在 `.runtime/AIRI-046-delivery-failed-native.json` 和 `AIRI-046-lint-failed-native.log`。

项目知识复核已完成：Wiki 55 篇全部已核对，0 待复核、0 错误。
`scripts/generate-project-index.mjs` 目录同步与 `git -C airi diff --check` 均通过，结果随 AIRI-046 记录。

## 未验收范围

本轮没有使用真实模型生成或真人麦克风连续对话，未验收实际语音识别质量、设备播放效果和人脸换人体验。
协议、页面、IndexedDB、虚拟列表与服务启停验证不替代这些现场测试。
没有读取或删除私人对话，没有调用付费模型，没有修改人物数据库内容。

## 主要入口

- `packages/realtime-voice/src/doubao.ts`：输入、输出话轮与转写去重。
- `packages/stage-ui/src/stores/modules/realtime-voice.ts`：临时字幕与原有确认保存。
- `packages/stage-ui/src/stores/chat/session-store.ts`：统一转写消息构造及时间。
- `packages/stage-ui/src/components/scenarios/chat/components/history.vue`：字幕合并、阅读样式和回到底部。
- `packages/stage-ui/src/components/scenarios/chat/components/reading-controls.vue`、`stores/settings/chat-reading.ts`：阅读入口与本地偏好。
- `packages/stage-layouts/src/components/Layouts/`：桌面及移动舞台接线。

