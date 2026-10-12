# 主动社交实际验证记录

日期：2026-09-30。源码基线 `main@2e0e963670e5435a2909149fff1f83b93f8ffd11`。
本轮修改保留在现有工作目录，未提交远端。保留原有访客与其他未提交开发内容。

## 完成的工程行为

默认主动模式自动请求摄像头，持续本地感知。舞台按钮可切换被动模式并保存选择。
稳定单人在场触发问候，陌生人收到姓名问题。真实文字或最终语音回答启动自然建档，不需手工登记或校准。
十个一致清晰样本自动保存，正常交流中补充正面、左右角度的人脸裁剪及模板。
模板、照片和记忆正文使用 Windows DPAPI 加密。记忆按人物和角色隔离，真实事件去重并限制数量。
主动闲聊复用已配置模型与实际记忆。无模型时只有本地文字模板，不声称自由对话已配置。
已有实时语音可在见到人时接入一次，使用官方主动发声事件，不伪造用户输入。
实际用户语音、ASR和助手输出优先。切换模式、人物消失、会话变更和停止均取消迟到输出。
纠正姓名时不继续加载此前错误匹配人物的记忆。多人、失效帧与撤销后的排队输入不写档案。

## 已执行检查

Node 命令先由 `scripts/airi-env.ps1` 初始化。浏览器使用现有 `.tools/playwright`。

| 位置与实际命令 | 结果 | 证据 |
| --- | --- | --- |
| 工作区：`scripts/vision.ps1 test` | 29 项通过，含真实 DPAPI、自然建档、多角度模板、记忆隔离、拒绝与姓名纠正 | `unit-tests.actual.json` |
| 仓库根：`node node_modules/vitest/vitest.mjs run --project local-vision` | 11 项通过，含持续在场闲聊、忙碌结束后问候、人物更替、冷却与隐私 | 会话工具输出 |
| `packages/realtime-voice`：`node ../../node_modules/vitest/vitest.mjs run` | 13 项通过，真实本地双 WebSocket，模拟上游，主动语音、上下文及 ASR 打断顺序 | 会话工具输出 |
| `packages/stage-ui`：browser 项目，`local-vision`、`local-vision-capture`、`voice-transcript`、`realtime-audio` | 9 项通过，真实 Pinia、Chromium、画布流与 AudioWorklet | `.runtime/companion-browser-final.log` |
| `packages/stage-ui`：node 项目，`chat.contract`、`wire-message`、`hearing`、`hearing.analytics` | 67 项通过，真实输入接入、派生消息排除及转写生命周期 | 会话工具输出 |
| 工作区：`scripts/vision.ps1 integration` | 退出 0，真实 CUDA 模型处理五帧生成灰图，鉴权、私有文件保护、拥有者及释放通过 | `service-integration.actual.json`，`.runtime/companion-integration-final.log` |
| `pnpm typecheck` | 退出 0，55 个工作区任务通过 | `.runtime/companion-typecheck-final.log` |
| `pnpm lint` | 退出 0，0 错误，605 个既有警告 | `.runtime/companion-lint-final.log` |
| i18n、local-vision、realtime-voice 包 build | 全部退出 0 | 会话工具输出 |
| `pnpm -F @proj-airi/stage-web build` | 退出 0 | `.runtime/companion-web-build-final.log` |
| `git diff --check` | 退出 0，只有换行转换提示 | 会话工具输出 |
| 初始化 Node 后 `scripts/generate-project-index.mjs` | 退出 0，72 个包、5498 个源码文件已同步 | `开发文档` 的索引与清单 |
| 浏览器实际页面 | 主动按钮、被动关闭、刷新后模式持久化及返回主动模式可验证 | `active-companion-settings.png` |

本轮相关自动测试合计 **129 项通过**。这不是原规范 82 项完整场景验收结论。
报告中的 `node` 指上述初始化得到的 `$AiriNode`，不是另行安装的系统运行时。

## 额外回归失败

另跑既有 `src/stores/chat/session-store.browser.test.ts`，五项失败，退出 1。
错误为 `Must be called at the top of a setup function`，该测试使用未挂载 i18n 的测试环境和 Pinia 替代 store。
调查时改用真实 store 挂载可运行部分场景，但云网络模拟仍未生效。没有用增加替代 store 或断言改写隐藏问题。
该文件已恢复到本轮开始时内容，`git diff --numstat` 对它无输出。失败未计入 129 项通过统计。
证据位于 `.runtime/companion-existing-session-tests.log`。测试环境修复单列后续任务。

## 未配置、未测试及现场限制

- 本机服务 ready，实际 device 为 cuda。当前浏览器调用摄像头得到 `NotFoundError`，界面显示“浏览器未发现摄像头”。
- 当前浏览器聊天模型未配置。未添加或读取用户新密钥，没有创建账户或付费额度。
- 没有真人姓名、照片、记忆素材进入本轮测试报告。数据库测试使用生成向量、测试姓名及独立临时数据库。
- 真人见面问候、真实身份和多角度识别、实际语音回答与记忆闲聊质量尚未现场验收。
- 自动实时通话的接口和网关已实现并测试，真实豆包连接与费用授权仍依赖已有有效配置。
- Grounding DINO 仍未准备。完整性能、角色帧率和八小时稳定性测试未执行。
- 不标记 `ENGINEERING_READY` 或 `FULL_ACCEPTED`。`AIRI-009` 保留真人质量与完整验收工作。

操作说明见工作区 `开发文档/07-local-vision.md`，架构变更见 `docs/ai/adr/2026-09-30-active-social-companion.md`。

## 2026-10-01 持续识别与语音姓名修复

用户在笔记本现场确认摄像头和语音可用，报告再次见面不认识、身份在姓名和陌生人之间变化。
本节使用脱敏统计，真实姓名、人物 ID、照片、向量与凭据不进入报告。

### 找到的原因与修复

- 普通帧更新生成新的监听数组，重复取消尚未完成的问候。改为比较模式、会话与轨迹标量。
- 摄像头恢复被主动思考和麦克风等待阻塞。感知维护改为独立时钟，先初始化访客会话。
- 音频宿主权错误地阻止纯文字问候。文字与发声分别检查实际条件。
- 已确认身份在实时通话连接中到达时上下文被跳过。通话就绪、档案和记忆读取完成后立即更新。
- ASR 的完整假设和最终姓名被当作增量拼接，生成重复介绍文本。回归先复现失败，再改为完整结果替换。
- 同一人的正确和异常姓名产生两个档案，跨档案特征最佳相似度中位数约 0.975，破坏唯一候选间隔。
- 停止服务后备份加密 SQLite，合并已核查的重复档案。当前保留 23 个样本、3 个角度照片和 6 条交流记忆。
- 对原有三个加密裁剪解密后在内存重新提取 SFace，最佳自身匹配为 0.993–0.995，没有导出照片。
- 新建档案需十个新样本高度吻合唯一已有档案才复用，不按相同姓名合并，也拒绝异常重复介绍姓名。
- 已确认轨迹使用独立保持阈值，短暂模糊最多保留 1.5 秒。陌生脸、多人和过期证据重新确认。
- 匹配质量与入库质量分开，中等质量帧不能添加照片或模板。短暂漏检不虚构人物或绑定话语。

### 本次执行结果

| 检查 | 结果与证据 |
| --- | --- |
| `scripts/vision.ps1 test` | 39 项通过，`.runtime/vision-repair-python-tests.log` 与 `unit-tests.actual.json` |
| 连续身份 Python 场景 | 使用真实 ByteTrack、People 和临时数据库，替换外部模型边界。短暂模糊、持续模糊过期、多人撤销、检测漏帧恢复、中等质量禁止入库通过 |
| realtime-voice 包 `vitest run` | 14 项通过，包含累积识别假设修正姓名的回归，本地模拟上游 |
| stage-ui browser：`companion`、`local-vision`、`local-vision-capture` | 6 项通过，正式 Runtime、真实 Pinia、画布摄像头及 LV01。连续帧不取消问候，被动释放和再次主动恢复已知身份通过，识别服务为外部替身 |
| local-vision 包 `test:run` | 11 项通过，`.runtime/vision-repair-policy-tests.log` |
| 根 `pnpm typecheck` | 55 个任务成功，退出 0，`.runtime/vision-repair-typecheck.log` |
| 根 `pnpm lint` | 0 错误、605 个既有警告，退出 0，`.runtime/vision-repair-lint.log` |
| i18n 和 realtime-voice 包 build | 退出 0，实际 Web 服务已重新启动以加载实时语音修复 |
| stage-web build | 退出 0，21.53 秒，`.runtime/vision-repair-web-build.log`。字体预取和既有打包警告不阻止构建 |
| `scripts/vision.ps1 integration` | 重启修复后的真实服务处理五个生成 JPEG，退出 0，device=cuda，`.runtime/vision-repair-integration.log` |
| 修复后的健康与指标 | ready=true，quality 指标已生效。合成测试后收到和处理均为 5，已释放连接 |

相关自动测试共 70 项通过。浏览器姓名恢复使用模拟推理，真实数据库持久化由 Python 测试分别覆盖。
实际加载的仍是 YOLOX、ByteTrack、MediaPipe、YuNet 和 SFace，模型保持常驻，摄像头只在主动拥有者存在时采集。
代理浏览器没有摄像头，不代表笔记本没有摄像头。当前没有最新修复后的真人识别率、闲聊质量或耗电结论。
原始八十二项矩阵、完整性能与八小时稳定性继续由 AIRI-009 跟踪。
轻量开源候选和连续识别调度研究见工作区 `开发文档/07-local-vision.md`，没有安装新模型或宣称节能已实测。
