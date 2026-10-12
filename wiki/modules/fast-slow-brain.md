# 快慢脑协作与文字入口

2026-10-11，AIRI-037：统一关闭取消快慢脑、普通生成和待播结果，迟到完成不能发声；休眠禁止共享文字入口与实时连接，保留记录和配置。启动自检只检查配置与网关，不代替实际模型工作。既有派发、播放和档案回归随固定门禁保留，见[统一启停](stage-runtime.md)。

核对日期：2026-10-06。范围：本地Web豆包会话、会话策略与免费搜索。关联任务：AIRI-016、AIRI-017、AIRI-018、AIRI-020、AIRI-021、AIRI-022、AIRI-023、AIRI-026、AIRI-004。

## 分工与输入

豆包Seeduplex实时语音3.0是快脑，负责即时对话、一次真实受理确认和结果表达。
BrainRuntime是代码运行时，维护事实、队列、版本、取消和投递，不增加协调大模型。
慢脑用意识模块选中的模型，经core-agent.streamFrom持续生成和执行已有授权工具。
内置read_conversation_records查询当前会话数据库，只读有界记录，排除中断/视觉派生助手输出。
没有新增外部数据库、账号、付费服务或默认桌面操作权限；未选择慢脑时不提供spawn_thinking。

桌面/移动布局的use-chat-input将纯文字送入已配置慢脑与任务运行时，活动语音会话也接收文字请求。
纯文字不捕获麦克风、播放音频或连接豆包；语音中由豆包读出文字任务结果。图片和普通生成仍用既有模型，缺少配置时提示解决方法并恢复草稿。
本机Web/preview与既有LAN代理提供网关；Electron、Pocket、纯静态页面未增加宿主网关。

## 联网边界

豆包原生搜索当前被doubao.ts固定关闭，前端没有原生搜索设置。官方要求搜索服务开通、搜索类型与独立搜索Key。
普通聊天与慢脑共用web_search。设置总开关打开且选择Firecrawl时挂载真实匿名免费搜索；选Tavily时仍需Key。总开关默认关闭，选择保存在当前浏览器域名。运行时扩展工具须另查实际注册状态。
DeepSeek provider走Chat Completions，官方此接口只支持应用函数工具，不自动执行网页搜索。选择慢脑与开启深度思考均不等于开启搜索。
纯文字不连接豆包，因此快脑原生搜索也不能自动供文字慢脑使用。能力判断以请求和执行证据为准。
模型发出函数调用后才执行搜索。慢脑先解析工具，再组合包含搜索指导的系统提示；真实工具结果中的来源进入evidence并交回快脑。没有按关键词模拟搜索，也不把模型编的链接当检索证据。
快脑在启动和活动更新时读取ThinkingCapabilities，来自同一慢脑configured与搜索configured/lastFailure门控。状态为enabled/disabled/blocked，错误取脱敏实际失败，不含Key。配置不是成功证明；历史“不能联网”不能覆盖当前工具能力。豆包原生搜索关闭不影响后台web_search，启用时快脑模型应通过spawn_thinking派发在线查证。
context命令带必需slowBrain布尔值，网关按当前状态重算session.tools。完整session.update仍保留model/audio/extension；模型和搜索配置变化、实际错误与恢复同步当前通话，不增加第三个模型或关键词规则。面板显示慢脑联网状态与设置入口。见[AIRI-021修复报告](../../airi/docs/ai/reports/2026-10-03-voice-slow-brain-link.md)；自动闭环通过，真实豆包选择FC与真人体验仍需验收。
Firecrawl经Web同源网关：留空Key由主机执行官方CLI匿名搜索；显式账户Key由主机调用官方/v2/search。两条路径只查web、最多10条，无附加抓取、自动升级或付费回退。匿名CLI拒绝环境或已保存凭据，防止自动复用其他账户。网关限定本地同源、输入、并发与超时，不转发Cookie或LAN票据。Web/preview与既有LAN代理可用，纯静态、Electron、Pocket尚无搜索宿主。
设置页有官方注册/控制台、独立Firecrawl Key、真实来源/消耗/回执与服务端账户余额。Free每月1,000 credits不等于匿名额度，余额接口也不能验证套餐或自动充值状态。Key只在当前浏览器，回执和余额不持久化。权限/额度/网关错误脱敏后显示，暂停后续模型请求；配置修改或手动测试可恢复，旧代际响应不能影响新配置。不把服务拒绝解释为整机断网。
AIRI-020本机网关查询南宁天气返回真实来源，浏览器按钮返回官方价格页；49项相关回归、55项类型检查任务、lint与构建通过。当前测试浏览器未配置慢脑，真实DeepSeek/真人语音仍未验收。网页摘要可能陈旧，搜索成功不证明已取得气象实测。
参考[403修复报告](../../airi/docs/ai/reports/2026-10-03-firecrawl-403-fix.md)、[历史接入报告](../../airi/docs/ai/reports/2026-10-03-firecrawl-search.md)与[联网核对报告](../../airi/docs/ai/reports/2026-10-03-search-capability.md)。Codex skill和AIRI运行时工具分别接线。

## 事实、任务与版本

共享的是权威事实，再分别投影：快脑读取近期确认内容和当前结果；慢脑读取派发时事实、任务约束、角色、陌生人身份与授权上下文。
私有分析和完整工具数据库返回不写入聊天历史。AIRI-035 独立向快脑提供当前关系的少量档案摘录，作为有来源的引用数据，JSON 上限 2800 字符。实时确认事实仍最多64条/16,000字符，每条4,000字符。
用户只记录最终转写/已发送文字。语音需provider音频结束且本地队列排空才确认；打断整句保守排除，协议没有词级播放对齐。
文字显示完成即确认送达。Provider自己的草稿历史不等于应用确认事实，提示明确二者优先级。

spawn_thinking返回task_id与task_version的立即回执。最多8个活动/未送达任务FIFO执行，90秒超时。
相同来源轮次的重复派发去重；语音明确改要求或文字按“修改任务”带当前ID/版本，新版替换旧版并abort。闲聊不中止任务。
取消带版本，只处理匹配任务。角色、账号、会话、generation、导航、隐藏或挂断使本轮任务失效。
迟到结果即便忽略abort也不能投递；已经开始的外部工具副作用不能自动撤销。任务不跨设备同步、不持久化。

## 会话策略与真实进度

参考“快脑方法论探索”的可读计划正文，保留当前运行时增量适配，未照搬24项任务或66项验收，引用附件未出现在可读资源中。
conversation.ts在现有实时语音包中提供自然协作、简洁办事、陪伴倾听与基础模式。选择保存本机，经启动、session.update和worker请求进入真实模型上下文，不是仅存放SKILL.md。已派发请求保留派发时策略；当前明确用户要求优先。基础模式只关闭新增表达策略和等待提示，任务与安全投递仍在。
情绪理解依赖模型读上下文，不用关键词标记情绪，不新增协调模型、人格评分、长期关系状态或独立服务。沿用豆包话轮事件，不把静音秒数或所有人声改造成自研轮替判断。
ThinkingProgress来自queued/working及实际工具execute的tool_started/tool_returned/tool_failed边界；当前版本有效时才投影，私有分析、参数与返回正文不进进度。工具返回不自动代表成功。
自然模式在受理约15秒仍未完成时，只有空闲且无可交付结果才朗读一次快脑拟定的等待稿。稿件未提供时只显示真实进度；每版本最多一次。其他模式不主动补等待语。这是工程检查，不是通用尴尬阈值，也不保证达到固定延迟或完成时间。

## 结果与发言

AIRI-024新增高表达、低回应索取的活泼话痨风格。复用当前人物卡、已选慢脑及单一豆包发声队列，以应用事件准备短片段，用户与正式任务优先，实际播放后确认事实。支持独立暂停/继续、迟到稿隔离和请求预算；纯文字不自动续聊。实现、限制及验收见[话痨专题](chatty-conversation.md)。

结果含task_id/version、status、result_summary、evidence、suggested_utterance、delivery_policy。
证据只来自实际工具返回/服务端引用，模型自述来源不算已查询。失败与需要补充也有结构化状态。
真实受理后，应用在用户不说话、无生成/播放且空闲200ms时朗读一次快脑在spawn_thinking.acknowledgement中拟定的过渡语，每个任务版本去重。迅速完成省去过渡语。AIRI-026由快脑按当前人物拟定受理和waiting_utterance，应用不再随机选固定台词；文字任务或模型缺少受理稿时使用中性真实回执。两边系统提示均带当前人物，但豆包直接TTS不再改写稿件。FC移交释放响应占用，工具回执后取消原生续答；后台完成时等空闲700ms自动授予一个结果发言机会，无需用户追问。
结果留在应用队列与面板；pending/speaking只投影任务元数据，不把摘要或建议发言同时交给模型。应用是过渡语和结果的唯一发声调度者；delivered/context_only才向模型投影结果，确认对话仍共享。此方案替代AIRI-016/021中“待播稿先进入快脑上下文”的双路径。
when_idle等空隙；context_only保持静默；immediate也尊重用户发言。AIRI-023替代打断后自动重述：结果回到pending并暂停自动投递，后台仍继续。UI暂停/继续或模型按当前用户请求调用set_agent_delivery(paused|automatic)控制发声，取消依旧单独带任务ID/版本。
慢脑按当前策略直接生成口语化result_summary；文字显示与语音发声用同一摘要，suggested_utterance仅保留预览，不二次改写事实。数字、单位、否定、条件、不确定性进入worker提示约束；应用原样传递摘要，防止两份稿件矛盾，但不能证明摘要本身真实。
摘要上限3000字符，TTS按至多400字符无损分段；每段匹配结束且排空才进入确认事实，全部分段确认才标记delivered。已确认段不重播，明确继续时只播未确认部分；中断段没有词级对齐，从该段开头重述。确认偏移、提示去重、暂停只存当前窗口，结束清理。
取消或新版替换正在播的任务时中断旧发言，旧确认不能把新版标记已送达。
快脑任务JSON投影不超过4,500字符，先裁字段再裁条目；当前确认对话投影约2,500字符，更新按序发送。
AIRI-027对完整instructions施加16000字符预算：保留策略及有效事实/任务JSON，再给人物最多5000字符，视觉使用剩余空间至多1000字符，不裁断结构数据。自动片段计时、真实门控和有限反思见[话痨专题](chatty-conversation.md)。普通视觉帧刷新不取消草稿，权限或相遇变化仍失效。阶段只按确认播报推进，新用户转写归零；模型判断话题与情绪，应用不保存沉默推断。

## 协议与验证入口

工具下行为items批次，上行按call_id整批回传，去重已受理调用。
重复派发不打断正在朗读的受理语。取消判断必须带非空任务ID，不能因为两个undefined相等而打断。speak带应用ID；chat_tts_text音频开始映射服务端response_id，分片及结束回传speechId。无ID的response.done不确认朗读，旧结束和重复结束不确认新结果；匹配结束且本地排空后确认送达。
完整session.update保留model/audio/tools和顶层extension。结果走speech_text_buffer.commit直接朗读已知发言稿，不造response.create。实测它不返回文字回答，Qwen的用户文字映射不能用于本接口问答，文字提问用慢脑。
context-only历史成对conversation.item.create；纯文字没有语音连接，语音后台工作仍继续听；关闭等session.closed或有界超时。
前端悬浮面板默认收起详情，展开有界滚动，不占人物和聊天框的布局空间；显示模式、慢脑选择、任务版本/状态/摘要/来源、取消和修订，选择不证明服务已连通。

- [brain.ts](../../airi/packages/realtime-voice/src/brain.ts)、[brain.test.ts](../../airi/packages/realtime-voice/src/brain.test.ts)：调度和版本。
- [conversation.ts](../../airi/packages/realtime-voice/src/conversation.ts)、[增量改进报告](../../airi/docs/ai/reports/2026-10-04-fast-conversation-policy.md)：真实上下文策略、等待边界与摘要表达。
- [slow-brain.ts](../../airi/packages/stage-ui/src/stores/modules/slow-brain.ts)：后台模型与真实工具接线。
- [实时store](../../airi/packages/stage-ui/src/stores/modules/realtime-voice.ts)、[入口](../../airi/packages/stage-ui/src/composables/use-chat-input.ts)：会话和送达。
- [浏览器测试](../../airi/packages/stage-ui/src/stores/modules/realtime-brain.browser.test.ts)：已选模型的无麦克风文字、队列排空、真实工具轮次和空隙投递。
- [验证报告](../../airi/docs/ai/reports/2026-10-02-fast-slow-brain.md)、[使用指南](../../开发文档/06-realtime-voice.md)：执行命令与实际服务限制。

返回[Wiki首页](../README.md)。

2026-10-09，AIRI-034：普通聊天、快脑和慢脑统一读取舞台本地账户身份。账户切换使旧任务与转写的用户范围失效并结束旧通话；人物姓名使用引用数据进入上下文，不授权工具或开发者管理。人物聊天按持久人物 ID 保存，详见[账户数据流](../flows/visual-social.md)。

2026-10-06，AIRI-028：greeting与continuation使用同一慢脑准备槽和30次预算，但已播问候不消耗试探机会。视觉scope变化只取消捕获过上下文的准备/自动播报，不重排空闲截止时间。人脸补采诊断不进入快慢脑上下文。


2026-10-08，AIRI-033：提示词从源码内置改为[前端可编辑配置](brain-prompts.md)。中文默认值、schema及浏览器store统一管理，保存内容进入快脑启动/context、慢脑正式任务及问候续聊。
输出协议、真实工具门控与播放确认由程序保留。预览使用实际规则来源，不冒充完整运行时抓包。

AIRI-035：慢脑的实际请求增加当前人物与智能体的档案回顾及四类持久检索/整理工具。快脑只带有界回顾，深入检索沿用 spawn_thinking。后台结果的版本、播放确认和唯一发声机制保留，页面关闭不关闭检索服务。见[聊天档案](chat-archive.md)。

2026-10-11，AIRI-036：启动等待当前人物会话激活并复核归属；同会话快照刷新保留通话。快脑档案回顾只等待至多250ms，迟到读取由通话代际和读取序号隔离，存储错误单独提示。既有派发、唯一发声和送达确认保持，见[修复报告](../../airi/docs/ai/reports/2026-10-11-voice-and-settings-regression.md)。
