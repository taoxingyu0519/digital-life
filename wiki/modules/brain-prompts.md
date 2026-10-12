# 快慢脑系统提示词编辑

2026-10-11，AIRI-037：舞台启停不重置已保存规则；休眠时设置仍可编辑，关闭使旧任务失效。固定门禁继续保留原提示词版本回归，见[统一启停](stage-runtime.md)。

核对日期：2026-10-08。任务：AIRI-033。

## 前端与设置接口

入口为实时对话页的“快慢脑系统提示词”。主区域编辑快脑fast与慢脑slow。
附加区编辑result、continuation、core和当前styles。默认行为规则为中文。
`useBrainPromptsStore`提供config、invalidStored、revision、save和reset。
完整快照经Valibot校验后写当前浏览器域名localStorage，不保存到服务端、人物记忆或云端。
恢复默认先修改草稿，保存才应用。无效持久内容显示错误并暂用合法默认值。

## 实际模型数据流

fast进入豆包start及context命令。slow进入正式后台system消息，result控制原样朗读的result_summary。
continuation与styles.chatty进入问候/续聊拟稿请求，不伪造用户新轮次。
core和当前风格进入快脑非基础模式，当前风格也进入慢脑表达。
当前人物卡继续提供身份、描述、性格和场景。工具提示由实际已注册工具贡献。
预览读取真实规则来源，动态事实、视觉与任务资料在发送时另行加入。

## 生命周期与边界

活动通话或文字模式中UI不能保存。通过设置接口改版本时，现有实时store结束旧通话并清理工作。
续聊捕获prompt revision，修改后迟到稿不能发声。
程序保留JSON协议、长度校验、工具权限、任务取消/版本与播放确认，不交给可编辑提示词执行。
不同设备、域名和浏览器分别保存，编辑本地提示词不等于修改所有客户端。

## 源码与证据

- [默认值与契约](../../airi/packages/realtime-voice/src/prompts.ts)。
- [设置接口](../../airi/packages/stage-ui/src/stores/modules/brain-prompts.ts)。
- [前端编辑器](../../airi/packages/stage-ui/src/components/scenarios/brain-prompt-editor.vue)。
- [实际后台接线](../../airi/packages/stage-ui/src/stores/modules/slow-brain.ts)、[快脑接线](../../airi/packages/stage-ui/src/stores/modules/realtime-voice.ts)。
- [中文验证报告](../../airi/docs/ai/reports/2026-10-08-brain-prompt-editor.md)。

74项相关回归、55类型任务、lint与构建通过。模型边界替身证明请求接入，不证明真实模型遵从度。
实际中文页面可见，真人自定义规则效果仍归AIRI-004验收。
返回[Wiki首页](../README.md)。

2026-10-09，AIRI-034：舞台人脸账户属于发送时的动态事实，不写入可编辑的固定提示词。普通聊天与快慢脑共同引用当前姓名和本地账户范围；换人结束旧通话与后台工作。既有规则编辑、保存版本及工具权限继续由原接口控制。

AIRI-035：历史回顾是请求时重读的引用数据，档案工具权限由代码持有，不作为可编辑系统提示词保存。快脑的档案委托指引来自运行时，仍使用已保存的人物卡与工作规则。见[聊天档案](chat-archive.md)。

AIRI-036：档案回顾读取改为有界等待及同通话迟到更新。保存的提示词版本变化仍关闭旧通话，本轮47项实时协作浏览器用例包含原提示词隔离回归，历史验证数字保留。
