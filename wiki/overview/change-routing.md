# 开发问题与修改入口

核对日期：2026-10-06。范围：当前本地分支。关联任务：AIRI-013、AIRI-016、AIRI-018、AIRI-028、AIRI-029。

先选择职责，再沿调用链读取。文件定位后，使用 rg 搜索函数或字段，避免一次加载整个包。

## 按需求定位

| 需求或故障 | 首读专题 | 优先源码 | 相关验证 |
| --- | --- | --- | --- |
| 回答内容、工具轮次、上下文 | [对话](../modules/chat.md) | stage-ui/stores/chat.ts、core-agent/runtime | chat.contract、context-registry、chat-orchestrator-runtime |
| 退出后仍记住账号姓名 | [对话](../modules/chat.md) | chat/context-providers/user-account.ts | user-account.browser |
| 人脸账户姓名、换人或历史串档 | [视觉数据流](../flows/visual-social.md) | stage-ui/stores/stage-identity.ts、local-vision.ts、chat/session-store.ts、HeaderAvatar.vue | stage-identity.browser、session-store.browser、realtime-brain.browser |
| 识别跳名、误认、模糊或重复档案 | [视觉算法](../algorithms/local-vision.md) | model.py、recognition.py、identity.py、social.py | testmodel、testrecognition、testidentity、testsocial |
| 角度/光照失认、候选复核、扩展撤销 | [轨迹补采](../algorithms/face-adaptation.md) | adaptation.py、model.py、recognition.py、developer.py、memory-manager.vue | testadaptation、testmodel、testdeveloper、memory-manager.browser、adaptation-probe |
| 摄像头不开、旧画面或权限失效 | [视觉数据流](../flows/visual-social.md) | local-vision store、client、contracts | local-vision.browser、local-vision-capture.browser |
| 不主动问候、闲聊抢话 | [主动交流](../modules/companion.md) | companion.ts、local-vision/policy.ts | companion.browser、policy.test |
| 语音姓名拼接、转写重复、打断 | [语音](../modules/voice.md) | realtime-voice/doubao.ts、realtime-voice store | doubao、realtime-audio.browser、voice-transcript.browser |
| 豆包文字报无聊天模型、后台任务、旧结果抢话 | [快慢脑](../modules/fast-slow-brain.md) | brain.ts、slow-brain.ts、use-chat-input、实时store/任务面板 | brain.test、gateway.test、realtime-brain.browser |
| 查看/修改快慢脑提示词、保存或旧稿隔离 | [提示词编辑](../modules/brain-prompts.md) | prompts.ts、brain-prompts store、brain-prompt-editor.vue、slow-brain.ts | realtime-brain.browser、conversation.test、共享客户端类型检查 |
| 无法联网、403、免费额度或搜索注册 | [快慢脑](../modules/fast-slow-brain.md#联网边界) | web-search.ts、web-search-contract、web-search-gateway、模块store、tool-resolver、WebSearch.vue、Web Vite配置 | browser回归、原生HTTP网关测试、tool-resolver、真实测试按钮 |
| 历史、人物记忆、导出与删除 | [数据与记忆](../modules/storage-memory.md) | database/repos、session-store、identity.py | session-store、wire-message、testidentity |
| 长期记忆聊天档案、跨会话查询和原文整理 | [聊天档案](../modules/chat-archive.md) | scenarios/chat-archive.vue、services/chat-archive、stores/chat-archive | chat-archive.browser、realtime-brain.browser |
| 姓名错字、本人确认和开发者维护 | [数据与记忆](../modules/storage-memory.md) | social.py、developer.py、memory-manager.vue、developer-access store | testsocial、testdeveloper、两个管理组件 browser test |
| 外观、口型、页面导航 | [客户端](../modules/clients.md) | Stage.vue、stage-pages、stage-layouts、model-driver-* | 对应包 typecheck 与已有测试 |
| 目光与头部人脸跟随 | [客户端](../modules/clients.md) | local-vision/gaze.ts、use-face-gaze.ts、Stage、head-gaze.ts | gaze.test、head-gaze.test、companion.browser、testmodel |
| 设备权限、LAN/UU、网关和重启 | [本地运行](../modules/local-runtime.md) | start-airi-background、start-airi、vision、lan-gateway、实际网卡与SSH配置 | SSH握手、真实健康回执、现场设备 |
| 舞台启停、关闭后重连、旧功能回归 | [统一启停](../modules/stage-runtime.md) | stage-runtime store、stage-runtime-controls、stage-runtime-gateway、vision.ps1 | test-airi-delivery.ps1、stage-runtime.browser、实际启停及设置/长期记忆导航 |
| Wiki、任务、知识过期 | [维护流程](../maintenance.md) | project-wiki、project-manager、workspace-source-files | Wiki check、管理 API、目录同步 |

表内 stage-ui 代表 airi/packages/stage-ui/src，Python 文件位于 airi/services/local-vision。

## 跨模块变更

帧协议变化同时核对 TypeScript、Python、代际校验和浏览器采集。
实时语音变化同时核对网关、Eventa 契约、store、转写写入和音频清理。
持久化变化同时核对隔离、删除、导入导出和同步排除。
文案变化读取 i18n 规则，再重建 @proj-airi/i18n。

## 回答用户问题

回答算法时，给出“输入 → 算法或规则 → 输出 → 限制”，并指向源码。
回答流程时，交代进程、数据落点、权限检查和失效条件。
回答成长历史时，指向决策或开发记录，不把历史方案当作当前事实。
如果 Wiki 标为待复核，先查看变化的源码再回答。找不到证据时写“待核对”。

## 证据

- [开发指南](../../开发文档/04-development-guide.md)：详细命令和定位表。
- [上游规则](../../airi/AGENTS.md)：源代码约束和必跑检查。
- [源码清单](../../开发文档/source-files.txt)：定位失败时的机械索引。

返回 [Wiki 首页](../README.md)。
