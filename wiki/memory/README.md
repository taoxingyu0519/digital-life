# 项目成长与开发记忆

这里记录系统能力如何形成、决策为何改变，以及下次开发可复用的知识。
核对日期：2026-10-06。关联任务：AIRI-013、AIRI-016、AIRI-017、AIRI-018、AIRI-023。

| 要了解什么 | 进入哪里 |
| --- | --- |
| 项目从安装到主动伙伴的成长 | [演进时间线](evolution.md) |
| 默认持续贴底、手动上翻和返回恢复 | [主舞台跟随记录](sessions/2026-10-31-stage-tail-follow.md) |
| 当前采用的设计及被替代方案 | [决策索引](decisions.md) |
| 故障原因与可复用经验 | [经验知识](lessons.md) |
| 一次开发的目标、结果和交接 | [开发记录](sessions/2026-10-01-project-wiki.md) |
| 连续识别优化与模型对比 | [科研识别记录](sessions/2026-10-01-adaptive-recognition.md) |
| 角色目光与头部追随人脸 | [人脸注视记录](sessions/2026-10-01-camera-face-gaze.md) |
| 豆包快慢脑与文字入口修复 | [快慢脑记录](sessions/2026-10-02-fast-slow-brain.md) |
| 模型API与实际联网边界 | [联网调查记录](sessions/2026-10-03-search-capability.md) |
| Firecrawl skill、免费真实搜索与前端回执 | [搜索接入记录](sessions/2026-10-03-firecrawl-search.md) |
| Firecrawl 403、官方CLI宿主与免费账户注册 | [搜索修复记录](sessions/2026-10-03-firecrawl-403-fix.md) |
| 语音拒绝查询而文字成功、慢脑能力和工具同步 | [语音联动记录](sessions/2026-10-03-voice-slow-brain-link.md) |
| 后台过渡语、主动播报、长音频和悬浮面板 | [播报修复记录](sessions/2026-10-03-voice-delivery-fix.md) |
| 会话风格、真实等待进度、暂停/继续与原样摘要 | [会话策略记录](sessions/2026-10-04-fast-conversation-policy.md) |
| 活泼话痨、低压力主动分享与有界续聊 | [话痨模式记录](sessions/2026-10-04-chatty-conversation.md) |
| 续聊错误诊断与人物过渡语接线 | [续聊修复记录](sessions/2026-10-06-chatty-preparation-and-persona.md) |
| 续聊启动、5/10秒等待与无回应换话题 | [等待与反思记录](sessions/2026-10-06-chatty-idle-and-reflection.md) |
| 记录下一次开发 | [开发记录模板](../templates/session.md) |
| 新端口配置空白、台式机共享与草稿保护 | [配置同步记录](sessions/2026-10-12-config-sync.md) |
| 人脸登录、离开退出与人物历史隔离 | [舞台账户记录](sessions/2026-10-09-face-stage-accounts.md) |
| 主动模式未联动实时语音与普通麦克风门控 | [语音联动排查](sessions/2026-10-08-active-mode-voice.md) |
| 姓名确认、原档案纠错与开发者记忆管理 | [记忆建设记录](sessions/2026-10-05-memory-management.md) |
| 清除人物全部记忆、浏览器整理残留与重新认识测试 | [人物清除记录](sessions/2026-10-19-person-forgetting.md) |
| 人脸不触发登录、匿名人物与逐消息归档标签 | [逐消息人物归档](sessions/2026-10-28-message-person-archive.md) |
| 实时字幕漏显、短答丢失、字号气泡和最新消息入口 | [主舞台阅读修复](sessions/2026-10-29-stage-history-reading.md) |

时间线描述工程演进，不表示基础模型自行训练。
事实专题写当前实现。历史记录保留当时条件，用“被替代”明确旧方案的边界。
任务事件是完整操作账本，Wiki 只提炼长期有用的原因和知识。

返回 [Wiki 首页](../README.md)。

[主动问候与计时排查](sessions/2026-10-06-active-greeting-and-recognition.md) · [连续轨迹补采与撤销](sessions/2026-10-06-trajectory-face-adaptation.md)。


[快慢脑提示词前端编辑记录](sessions/2026-10-08-brain-prompt-editor.md)：中文规则、浏览器设置接口、实际请求接入与版本隔离。

[聊天档案开发记录](sessions/2026-10-09-chat-archive.md)：按人物与智能体整理原文，页面和模型共用持久检索。

语音突然停止、网关恢复提示和设置入口回归，见[2026-10-11开发记录](sessions/2026-10-11-voice-and-settings-regression.md)。

[舞台启停与交付回归记录](sessions/2026-10-11-stage-runtime-and-delivery.md)：统一休眠、真实服务释放与恢复、固定旧功能门禁。

[笔记本端口冲突修复](sessions/2026-10-17-port-repair.md)：AIRI-040，保留另一项目，数字生命独立4173。

[陌生人认识与短语音记录](sessions/2026-10-18-stranger-introduction.md)：问候失败开场、姓名状态幂等、空闲核对与真实协议说明。

[多人画面与并行语音记录](sessions/2026-10-19-parallel-voice.md)：区分在场和身份、隔离迟到工具回执，并在后台未完成时验证下一轮对话。

[人脸稳定与每秒一次采集](sessions/2026-10-28-face-stability.md)：采样窗口、固定参考、短租期和目光保持须一起匹配采样周期。
