# 项目设计决策索引

核对日期：2026-10-04。这里解释采用理由，源码专题负责当前行为。
仓库正式 ADR 仍放在 airi/docs/ai/adr，后端 ADR 放在 server/docs/ai/adr。

| 决策 | 当前状态 | 理由与代价 | 证据 |
| --- | --- | --- | --- |
| 每请求计算账号或陌生人身份 | 采用 | 退出后不继承旧姓名，保留真实认证边界 | [user-account](../../airi/packages/stage-ui/src/stores/chat/context-providers/user-account.ts) |
| Python 离线视觉与同源票据边界 | 采用 | 浏览器负责设备，主机负责推理。两端契约需同时维护 | [视觉初版 ADR](../../airi/docs/ai/adr/2026-09-29-local-social-vision.md) |
| 当前请求临时视觉投影 | 采用 | 防止旧观察进入持久上下文与后续历史。增加派生消息排除规则 | [chat.ts](../../airi/packages/stage-ui/src/stores/chat.ts) |
| 默认持续主动、自然认识人 | 采用，替代默认关闭和强制手工校准 | 来自用户要求。保留权限、删除及现场质量验收 | [主动社交 ADR](../../airi/docs/ai/adr/2026-09-30-active-social-companion.md) |
| 确认与保持使用不同阈值 | 采用 | 保持连续性，同时对冲突、多人和超时重新确认 | [identity.py](../../airi/services/local-vision/identity.py) |
| 识别帧与入库帧分级 | 采用 | 中等质量可匹配，清晰大脸才能更新档案 | [model.py](../../airi/services/local-vision/model.py) |
| 实时语音使用官方主动发声和上下文事件 | 采用 | 复用现有通话，不伪造用户轮次。仍依赖上游权限 | [doubao.ts](../../airi/packages/realtime-voice/src/doubao.ts) |
| Markdown Wiki 与显式证据复核 | 采用，AIRI-013 | 无新账号或模型依赖。跨对话依靠读取文件，知识准确性由开发者维护 | [维护流程](../maintenance.md) |
| 统一休眠优先于模块偏好，固定旧功能回归 | 采用，AIRI-037 | 偏好保留，关闭取消设备与请求，归属核对后释放推理；需同时验证多窗口、迟到结果和实际启停 | [启停专题](../modules/stage-runtime.md) |
| EdgeFace S 与自适应频率 | 本机采用，AIRI-014 | 裁剪对比支持速度和跨角度折中。保留 SFace 登记，独立索引。现场误认和耗电仍待验 | [识别 ADR](../../airi/docs/ai/adr/2026-10-01-adaptive-face-recognition.md) |
| 摄像头人脸驱动目光与头部 | 采用，AIRI-015 | 复用现有检测，不等姓名。短期位置只在渲染层使用，头部叠加需每帧恢复 | [注视 ADR](../../airi/docs/ai/adr/2026-10-01-camera-face-gaze.md) |
| 豆包快脑、代码运行时、已有模型慢脑 | 采用，AIRI-016 | 立即受理与后台执行分开，共享确认事实。任务版本阻止旧结果；播放排空确认送达，不增加协调模型 | [快慢脑 ADR](../../airi/docs/ai/adr/2026-10-02-fast-slow-brain.md) |
| 应用统一调度后台受理语和结果朗读 | 采用，AIRI-022；替代待播稿进入模型生成上下文 | 消除双路径重复。待播结果仍在共享运行时，确认送达或context_only后投影模型；发言ID和播放排空确认事实 | [播报修复](../../airi/docs/ai/reports/2026-10-03-voice-delivery-fix.md) |
| 模型理解语境，运行时执行投递；摘要只有一个事实稿 | 采用，AIRI-023；替代建议话术作播报稿及中断后自动重述 | 现有包投影所选风格，真实工具进度驱动有限等待。原样分段摘要防止二次改写；暂停/继续独立于取消。不保证模型摘要本身真实 | [会话策略改进](../../airi/docs/ai/reports/2026-10-04-fast-conversation-policy.md) |

旧 ADR 的默认关闭、强制登记、校准门槛和通话抑制条款被新 ADR 替代。

AIRI-025 采用“行为记忆指导、代码保护写库”：姓名确认规则保存在既有 SQLite，复用对话投影，不新增智能体插件。
本人确认状态、人物更新和开发者鉴权由代码保证。提示词不能撤回已写入的错误姓名，也不能授权数据库管理。
旧档案保留并补问确认，纠错不按姓名新建人物。见[姓名确认 ADR](../../airi/docs/ai/adr/2026-10-05-name-confirmation-memory.md)。

AIRI-024采用“人物卡不换、风格可选、单片段应用事件”：已选慢脑准备可选闲聊，现有豆包队列掌握发言权，用户/任务优先。切换风格和恢复不重置预算，不增加摄像头之外的个人画像采集。代价是需要可用慢脑，并受原10分钟通话与30次请求限制；不保证全天陪聊。见[话痨专题](../modules/chatty-conversation.md)。
回答当前行为时读新决策。解释历史原因时同时引用旧方案和替代日期。

返回 [成长入口](README.md)。

AIRI-034采用持久人物 ID 对应的本地账户与瞬时身份租期。姓名改动只更新显示，云凭据和开发者会话独立。会话选择不重启摄像头，避免身份确认与退出互相触发。见[人脸账户 ADR](../../airi/docs/ai/adr/2026-10-09-face-stage-accounts.md)。

2026-10-06，AIRI-029：[轨迹复核决策](../../airi/docs/ai/adr/2026-10-06-trajectory-face-adaptation.md)。保留当前模型，采用基础/候选/扩展分离及可撤销批次。没有直接引入InspireFace、BoT-FaceSORT或PersonAnalysis，也未宣称其本机性能。


AIRI-033采用中文默认行为规则、完整快照校验和本地浏览器持久化。人物卡与工作规则分开，规则编辑不改变协议或工具权限。
三条模型请求同源，预览说明动态资料边界。见[提示词ADR](../../airi/docs/ai/adr/2026-10-08-brain-prompt-editor.md)。

AIRI-035：扩展既有 AIRI 界面和持久仓库，原文保存一份，摘要与备注关联来源。本人开放，其他人物浏览复用开发者授权，工具始终限定当前关系。见[聊天档案 ADR](../../airi/docs/ai/adr/2026-10-09-chat-archive.md)。
