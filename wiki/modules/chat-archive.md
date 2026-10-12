# 按人物和智能体的聊天档案

2026-10-11，AIRI-037：统一关闭释放模型和设备，持久原文及整理仍可浏览。实际休眠通过设置→机体模块→长期记忆进入聊天档案，固定门禁包含原分页、权限与模型工具回归。见[统一启停](stage-runtime.md)。

2026-10-11，AIRI-036：实时语音档案回顾仅等待至多250ms，迟到内容只更新同通话最新读取。错误独立提示并清除旧引用，音频继续。原文、工具和权限接口保留，同会话快照不再误挂断，见[修复报告](../../airi/docs/ai/reports/2026-10-11-voice-and-settings-regression.md)。

核对日期：2026-10-09。任务：AIRI-035。范围：当前浏览器来源内的持久聊天原文、整理和模型检索。

## 当前实现

设置 → 长期记忆 → 聊天档案采用两栏：左侧按人物与智能体列出交流关系，右侧连续翻阅该关系的多次会话。支持人物搜索、正文/备注/摘要/标签关键词查找、日期筛选、收藏、较早消息分页、原文上下文、整理、JSON 导出和本人消息确认删除。窄屏改为上下布局，沿用共享按钮、输入框、主题和气泡颜色。

原文沿用 `airi-local` 中的会话仓库。新消息补唯一 ID 和真实 `createdAt`，已有记录缺少时间时显示“时间未记录”，不补造日期。索引的可选 `displayName` 只用于显示；归属仍由账户 ID 和智能体 ID 决定。没有姓名的记录显示未命名，陌生人分区为 `local`。

整理信息保存于 `local:chat/annotations/<session>/<message>`，包含收藏、标签、备注、摘要、作者和更新时间。原话不因摘要被改写。原消息或会话删除会同步清理整理；删除与整理使用同一浏览器锁。Eventa 通过 BroadcastChannel 只传失效信号，其他窗口自行验权并重读，事件不携带正文、身份或摘要。

## 页面和智能体共用数据

`services/chat-archive.ts` 负责持久查询、上下文、整理和导出；`stores/chat-archive.ts` 负责当前人物/智能体权限、有界回顾和工具。页面关闭后工具仍可使用。

| 工具 | 能力与边界 |
| --- | --- |
| `find_chat_partners` | 查当前人物与当前智能体的交流关系，不列出其他人 |
| `search_chat_archive` | 跨会话关键词检索，单次最多 20 条，可指定毫秒时间范围 |
| `read_chat_archive` | 用来源 ID 读取命中前后原文，单条正文最多返回 2000 字符并标记截断 |
| `annotate_chat_archive` | 为原消息保存摘要、备注、标签和收藏；无删除工具 |

普通模型和慢脑注册上述工具。快脑启动和活动更新带少量回顾，需要查更多历史或整理时通过 `spawn_thinking` 委托慢脑。每次聊天从当前关系选取最近交流和少量收藏/摘要，总 JSON 上限 2800 字符；排除打断和视觉派生的助手内容。历史及整理明确包为引用数据，不授予指令权限，不持久写入系统提示桶。

## 权限和未验收边界

本人浏览可直接进入，其他人物查询刷新既有开发者会话；模型工具始终限定派发时的当前人物与智能体。每次异步读写前后检查身份/角色，切换后拒绝旧结果。人脸本地账户、陌生人入口及云认证沿用 AIRI-034，不创建 hosted 用户或付费权益。

这是同一浏览器来源内的档案，不是跨设备同步、全文数据库索引、向量搜索或模型训练。界面有分页，但底层仍读取现有整会话记录再筛选；大规模历史性能未验收。附件数量和原始内容可导出，当前页不提供完整媒体播放器。摘要由用户或模型工具整理，未实现对每次会话自动总结。真实配置模型的工具选择和回忆质量、真人多人进出及其他客户端现场体验仍需验收。

## 证据

- [共享服务](../../airi/packages/stage-ui/src/services/chat-archive.ts)、[权限与工具](../../airi/packages/stage-ui/src/stores/chat-archive.ts)、[事件边界](../../airi/packages/stage-ui/src/libs/chat-archive-events.ts)。
- [档案组件](../../airi/packages/stage-ui/src/components/scenarios/chat-archive.vue)、[长期记忆页](../../airi/packages/stage-pages/src/pages/settings/modules/memory-long-term.vue)。
- [浏览器验证](../../airi/packages/stage-ui/src/stores/chat-archive.browser.test.ts)、[真实请求边界测试](../../airi/packages/stage-ui/src/stores/modules/realtime-brain.browser.test.ts)。测试使用生成记录和模拟模型/语音外部接口。
- [中文交付报告](../../airi/docs/ai/reports/2026-10-09-chat-archive.md)。

返回 [Wiki 首页](../README.md)。
