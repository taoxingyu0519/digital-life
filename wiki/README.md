# 数字生命项目管理 Wiki

这里保存 AIRI 本地分支的项目知识和开发记忆。Codex 在新对话中先读本页，再按问题进入专题。结论以当前源码和验证证据为准。

## 先确定问题

| 需要做什么 | 只先读这一页 |
| --- | --- |
| 了解项目边界、已完成与待验收能力 | [项目现状](overview/project-state.md) |
| 找到修改入口、相关测试和文档 | [开发定位](overview/change-routing.md) |
| 解释角色如何生成回答 | [对话与上下文](modules/chat.md) |
| 解释摄像头、识别人脸与自然建档 | [本地视觉算法](algorithms/local-vision.md) |
| 排查角度/光照失认、轨迹补采与撤销 | [人脸鲁棒性](algorithms/face-adaptation.md) |
| 解释视觉、姓名、记忆如何进入回答 | [视觉社交数据流](flows/visual-social.md) |
| 排查人脸归档、稳定登录和气泡姓名标签 | [视觉社交数据流](flows/visual-social.md) |
| 解释主动问候和闲聊 | [主动交流](modules/companion.md) |
| 添加或排查话痨风格、无人回应续聊和暂停 | [活泼话痨](modules/chatty-conversation.md) |
| 解释实时语音与音频处理 | [语音链路](modules/voice.md) |
| 排查说话正常但主舞台漏记录、重复短回答 | [语音链路](modules/voice.md) |
| 调整聊天字号、气泡与回到最新消息 | [客户端与扩展](modules/clients.md) |
| 舞台启动/关闭、资源休眠与交付回归 | [统一启停](modules/stage-runtime.md) |
| 解释豆包快慢脑、文字入口和后台结果 | [快慢脑协作](modules/fast-slow-brain.md) |
| 查看和修改快慢脑、结果及续聊提示词 | [系统提示词编辑](modules/brain-prompts.md) |
| 换端口后配置重置、笔记本/台式机同步与冲突 | [配置同步](modules/shared-config.md) |
| 排查Firecrawl 403、注册免费账户、核对来源与额度 | [快慢脑联网边界](modules/fast-slow-brain.md#联网边界) |
| 解释存储、记忆、删除与隔离 | [数据与记忆](modules/storage-memory.md) |
| 优化聊天档案、按人物翻阅与智能体历史查询 | [聊天档案](modules/chat-archive.md) |
| 修改角色外观、页面或模型服务 | [客户端与扩展](modules/clients.md) |
| 启动服务、排查局域网和设备问题 | [本地运行](modules/local-runtime.md) |
| 了解项目如何成长及为何改变 | [成长记录](memory/README.md) |
| 保存本轮开发经验与维护知识 | [维护流程](maintenance.md) |

## 小范围读取

1. 读入口和命中的一篇专题。
2. 读专题里的源码证据与相关测试。
3. 遇到跨模块接口，再读相邻专题。
4. 只有目录定位失败时，才搜索完整源码清单。

工作区 PowerShell：

```powershell
. ./scripts/airi-env.ps1
& $AiriNode ./scripts/project-wiki.mjs find '为什么认识的人会跳名'
& $AiriNode ./scripts/project-wiki.mjs check
```

检索只返回最多五个专题的摘要、路径和证据状态。它不展开整个 Wiki，也不调用外部模型。
查看 [证据状态](index.md)。源码变化后标为“待复核”，不代表实现错误。

## 事实与记忆

专题描述当前实现。任务看板记录工作状态。成长记录保存历史决策和经验。
本 Wiki 是开发知识，未接入 AIRI 运行时问答。角色聊天记录和人物交流记忆另见 [数据与记忆](modules/storage-memory.md)。
新对话的上下文来自读取这些文件，不来自上一段聊天的隐式记忆。
不写入密钥、私人访问链接、人物姓名、照片、模板或私人对话。
