# 长期记忆轻量聊天档案交付与验证

日期：2026-10-09（Asia/Shanghai）。任务：AIRI-035。

## 结果

设置 → 长期记忆内增加聊天档案。左侧为人物与智能体的交流关系，右侧跨会话连续翻阅气泡原文；窄屏上下排列。支持关键词和日期查找、较早消息分页、收藏、来源上下文、标签、备注、摘要、JSON 导出及本人消息确认删除。开发者人物记忆维护保留在独立折叠区。

当前本人无需开发者登录即可查自己的记录；其他人物浏览仍复核既有开发者会话。人脸姓名关联沿用 AIRI-034 的持久人物 ID 与本地账户分区，不创建 hosted 账号，不改变陌生人或云端权益。未知姓名显示未命名，已有消息缺少时间明确显示未知。

页面与智能体共用同一份持久原文和来源整理。普通模型和慢脑注册查关系、跨会话搜索、展开原文和整理四类工具；页面关闭后仍可调用。快脑启动和活动更新引用小量近期/重要记录，需要更多历史时委托慢脑。回顾 JSON 预算 2800 字符，引用数据不授予指令权限。

消息或会话从任一历史入口删除，关联收藏、标签、备注和摘要一起清理。整理与删除使用同一浏览器锁，失效信号通过 Eventa/BroadcastChannel 通知其他读者重查；不广播正文。换人和换角色后拒绝旧异步结果。模型没有删除工具。

## 实际验证

命令从 airi/ 执行，先用 `../scripts/airi-env.ps1` 初始化已有 Node/pnpm。Chromium 使用工作区 `.tools/playwright`；外部模型和语音接口为测试替身，没有调用付费模型，也没有读取真人档案。

| 命令/方式 | 结果 | 证明范围 |
| --- | --- | --- |
| `vitest run --config packages/stage-ui/vitest.config.ts chat-archive.browser.test.ts chat.contract.test.ts session-store.browser.test.ts session-store.test.ts realtime-brain.browser.test.ts stage-identity.browser.test.ts tool-resolver.test.ts` | 7 文件、115 项通过；最终档案 4 项、语音/后台 43 项再次通过 | 原生 Vue/Pinia、IndexedDB、Web Locks、跨会话分页/检索、来源整理、删除清理、身份范围与现有文字/语音回归 |
| 档案真实请求边界测试 | 通过 | 页面关闭时，模拟模型实际发出搜索/整理工具调用；下一轮序列化请求携带持久原文，整理回写后 UI 服务可读取；普通文字请求及快脑启动含回顾 |
| `pnpm --config.verify-deps-before-run=false typecheck` | 55 个工作区任务通过 | 共享类型与 Web/Electron/Pocket 编译接线；不代表其他客户端现场验收 |
| `pnpm --config.verify-deps-before-run=false lint` | 0 错误、603 条既有告警 | 无新增依赖；未扩展范围处理原仓库告警 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/i18n build` | 通过 | 中英文新文案构建完成 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-web build` | 通过，13.38 秒 | 实际 Web 页面与共享依赖可打包；保留已有分包大小等构建提示 |
| 中文桌面/390px 深色页面截图及 DOM 操作 | 通过 | 关键词查找、原文展开、备注/摘要保存、重新挂载重读；窄屏无横向溢出。截图仅生成档案 |
| Wiki 人工复核、`project-wiki.mjs check`、`generate-project-index.mjs` | 43/43 专题当前，0 待复核/错误；目录同步通过 | 文档、来源与指纹维护，不代替模型/真人验收 |

Node 会话契约的旧 Pinia `storeToRefs` 模拟隐藏了新身份 store 的接线。已改为真实 Pinia refs 与所有权，仅保留输入和数据库/网络边界。普通文字的 Node 编排契约使用真实内存存储驱动，IndexedDB 持久化由原生浏览器测试另验。

## 当前限制

当前是关键词检索与来源摘要，没有向量语义搜索、自动事实提取、每次会话自动总结或模型训练。摘要由用户或模型工具整理，模型是否主动查询及回答准确率取决于配置服务，未用模拟接口宣称真实模型验收。

原文属于当前浏览器来源。跨设备/来源同步未新增，SQLite 人物交流记忆仍保持原职责。界面分页已实现，底层沿用整会话读取与筛选；大规模历史性能未验收。附件数量可显示，导出保留原内容，但页面未提供完整图片/语音播放器。真人多人进出、真实 DeepSeek/豆包回忆与客户端现场效果继续独立验收。

源码与数据流见[聊天档案专题](../../../../wiki/modules/chat-archive.md)，设计见[ADR](../adr/2026-10-09-chat-archive.md)。
