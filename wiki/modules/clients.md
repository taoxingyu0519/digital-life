# 客户端角色与扩展入口

2026-10-31，AIRI-047：主舞台默认锁定最新消息。悬停、焦点与选中文字不暂停；手动向上滚轮、触摸翻阅、键盘上翻或竖滚动条操作才解除。离底显示“回到最新消息”，点击或手动滚回底部恢复持续跟随。内容增高与字号重排受同一锁定控制，解除时取消尚在测量等待的定位。见[本轮记录](../memory/sessions/2026-10-31-stage-tail-follow.md)。

实页复现 Virtua 0.50.4 的内部测量重试会覆盖上翻，已改为使用公开条目几何的一次 DOM 定位。附加桌面布局浏览器回归保留输入框避让，测试环境修正 Pinia 与 Windows 样式扫描，不代表真实 Electron 窗口已经验收。

AIRI-046：桌面聊天框标题栏与手机顶栏增加 Aa。正文默认18px，可调14–30px；气泡有五档宽度与留白，支持恢复默认和刷新保存。阅读偏好只属于当前浏览器。字号重排保留阅读意图，暂停跟随时提供“回到最新消息”，不再让未滚到的消息看似丢失。实际100条生成历史可翻到首尾，见[记录](../memory/sessions/2026-10-29-stage-history-reading.md)。

2026-10-28，AIRI-045：右上角只显示原陌生人或真实认证账户，不再显示跳变的人脸账户。主舞台保持当前会话；用户/助手气泡上方有10px归属标签，匿名显示短ID，确认姓名后更新标签。设置与记忆入口保持原导航，详见[逐消息归档记录](../memory/sessions/2026-10-28-message-person-archive.md)。

AIRI-039：Web 初始化角色卡后接入[台式机配置同步](shared-config.md)，登录默认值后恢复用户慢脑选择。不同回环来源共享提示词、模型和会话偏好；设备、hosted 认证与档案继续使用原规则。Electron/Pocket 与旧LAN HTTPS未接入本轮宿主。

2026-10-11，AIRI-037：Web 舞台增加“启动/关闭”和逐项自检，休眠暂停人物渲染、采集和通话，保留全部设置和聊天档案。实际休眠导航通过。旧领导窗口缺少新 action 时控件显示刷新提示，不进入整页错误边界；空背景颜色采样保持现有主题。固定门禁包含真实 Color.js 浏览器回归，见[统一启停](stage-runtime.md)。

2026-10-11，AIRI-036：非compact舞台设置齿轮独立于账户分支。人脸、陌生人和云账户均保留全部设置，手机沿用原抽屉。实际设置→机体模块→长期记忆导航通过，见[修复报告](../../airi/docs/ai/reports/2026-10-11-voice-and-settings-regression.md)。

核对日期：2026-10-06。范围：客户端、渲染、配置和外部通道。关联任务：AIRI-006、AIRI-013、AIRI-016、AIRI-021、AIRI-022、AIRI-023。

Web、Electron 和移动端共享 stage-ui 业务层、stage-pages 设置页、stage-layouts 布局和 i18n。
客户端入口负责设备、生命周期和宿主能力。共享包存在不证明所有端都能运行某个设备功能。
首页“快慢脑协作”面板显示同源慢脑联网能力及网络搜索入口：已启用、未启用或实际服务错误暂停；未配置模型单独说明。配置不等于成功检索，回执和来源仍以工具实际返回为准。语音活动更新工具配置不重建连接，见[快慢脑专题](fast-slow-brain.md)。

实时对话设置新增会话风格，默认自然协作，可选择简洁办事、陪伴倾听或基础模式；本机保存并进入实际模型请求。首页通话面板新增暂停/继续结果，后台任务不因暂停停止，任务详情显示真实执行阶段。悬浮面板仍默认收起，不挤动人物与输入框。见[AIRI-023](../../airi/docs/ai/reports/2026-10-04-fast-conversation-policy.md)。

## 修改入口

2026-10-09，AIRI-034：Web 右上角显示当前确认人物的本地账户名，未知或离开后显示陌生人。
点击身份入口进入视觉设置。账户名称来自 `stage-identity`，历史来自人物 ID 对应的本地会话。
本轮不创建 hosted 用户，也未为 Electron/Pocket 新增摄像头宿主。共享显示组件在无摄像头账户模式时保留原云账号行为。
证据：[HeaderAvatar.vue](../../airi/packages/stage-layouts/src/components/Layouts/HeaderAvatar.vue)、[身份接线](../../airi/apps/stage-web/src/components/local-vision-runtime.vue)。

AIRI-025 将记忆占位页接入既有本地人物和行为记忆，将数据页接入数据库统计。
AIRI-042 将人物全量清除移到姓名旁，说明主机/当前浏览器范围并进行绑定人物的二次确认。完成后关闭舞台，开发者可以重新启动测试认识；其他来源、设备与未归属陌生人历史另行处理。
人物记忆维护、短期和数据管理页由本机开发者登录门控，服务端再次验权。AIRI-035 将长期记忆中的本人聊天档案独立开放，其他人物的档案仍需开发者授权。舞台仍可用陌生人进入。
当前只在 Web 与既有 LAN 代理验收，Electron/Pocket 没有新宿主网关。具体边界见[数据与记忆](storage-memory.md)。

AIRI-024在同一会话风格选择器增加“活泼话痨”，保留人物卡，设置页说明自动续聊需要慢脑、文字不自动续聊及30次/10分钟边界。AIRI-027增加默认5秒、1–120秒滑块与5/10快捷等待，立即生效并保存当前浏览器。首页悬浮面板按真实门控显示倒计时、倾听、播放、任务优先、准备、失败重试及未配置说明。新增状态不参与舞台纵向布局，不改人物与聊天框定位。

| 目标 | 先读源码 | 联动边界 |
| --- | --- | --- |
| Web 初始化 | [App.vue](../../airi/apps/stage-web/src/App.vue) | 会话、角色、设备、上下文桥 |
| 舞台和口型 | [Stage.vue](../../airi/packages/stage-ui/src/components/scenes/Stage.vue) | Live2D、Three/VRM、model-driver-* |
| 性格和角色系统提示 | [airi-card.ts](../../airi/packages/stage-ui/src/stores/modules/airi-card.ts) | 角色卡 UI 与 ccc |
| 模型服务定义 | [providers/index.ts](../../airi/packages/provider-inference/src/providers/index.ts) | 模型能力、协议、验证器和设置 |
| 设置导航 | [settings.vue](../../airi/packages/stage-layouts/src/layouts/settings.vue) | 桌面独立布局、共享页面和 i18n |
| 桌面窗口与宿主 | [main/index.ts](../../airi/apps/stage-tamagotchi/src/main/index.ts) | preload、shared Eventa 契约、renderer |
| 外部事件 | [server-sdk README](../../airi/packages/server-sdk/README.md) | server-runtime 与 server-shared |
| 桌面扩展 | [plugin-sdk README](../../airi/packages/plugin-sdk/README.md) | Manifest v2、Kit API、Eventa |

模型服务可来自远程或本地推理。AIRI 不包含可直接回答的完整大语言模型权重。
Ollama 和 LM Studio 有适配器。配置默认地址不证明本机服务已启动。
官方账号、云同步和额度服务仍走真实后端检查，陌生人入口不授予这些权益。

实时设置新增“聊天框使用后台任务与共享上下文”偏好、慢脑选择说明和意识设置入口。
舞台实时面板提供语音/文字连接、任务版本、状态、摘要、依据来源、取消与修改任务。
Web首页将面板放在绝对定位悬浮层，默认收起任务，展开详情有高度限制并滚动。面板高度变化不占纵向flex空间，桌面与390px窄屏实测人物画布和聊天框位置不变；除面板自身外，悬浮层不拦截舞台输入。
本机网关只由Web开发/preview与既有LAN代理提供；共享布局改动不代表Electron/Pocket新增了宿主网关。
具体任务与投递规则见[快慢脑协作](fast-slow-brain.md)。

## 摄像头目光和头部

Web 主舞台以本地人脸替代鼠标跟随。未知姓名的脸也能被注视，不新增模型或摄像头采集者。
Python 输出归一化 `face_bbox`。FaceGaze 镜像水平位置，按主目标、已有轨迹、最大可见脸选择并平滑。
目标只在当前采集窗口使用。漏脸容忍 250ms，年龄含往返延迟超过1500ms或观察有效期、权限撤销时释放。
2026-10-28，AIRI-044：送检每秒最多一次，目光保持覆盖采样间隔，细节见[视觉算法](../algorithms/local-vision.md)。
`useFaceGaze` 的 Vue RAF 随页面作用域停止。`Stage.gazePosition` 传给各场景，再按实际画布边界换算。
Live2D 通用动作驱动眼睛和头部，静止摄像头目标不受鼠标的一秒超时影响。
VRM 在动画之后叠加水平 ±0.3、垂直 ±0.2 弧度头部偏移，humanoid 更新前生效。
下一帧先恢复动画基姿态，避免偏移不断累积。失去目标平滑回到动画。
手工动作保留优先权。Magic、MMD、Spine 与静态立绘没有新增人脸头部控制。
本机部署与自动测试已完成，真人方向、幅度与延迟待笔记本确认。
证据：[gaze.ts](../../airi/packages/local-vision/src/gaze.ts)、[头部叠加](../../airi/packages/stage-ui-three/src/composables/vrm/head-gaze.ts)、[验证](../../airi/services/local-vision/reports/validation.face-gaze.md)。

## 扩展与产品后端

server-runtime 是外部事件 WebSocket 通道，默认端口 6121。
server/apps/api 是资源、同步和模型网关，server/apps/auth 是认证。
二者不能因名字相似而混用。改 hosted 后端时先读 server 下的 AGENTS 和对应 ADR。

本地版本删除了 Discord、X/Twitter、Minecraft 与 Factorio。
新增接口时先搜索现有共享实现，保持跨进程 Eventa 契约与模块边界。

## 详细资料

- [系统架构](../../开发文档/01-system-architecture.md)：完整目录职责。
- [开发指南](../../开发文档/04-development-guide.md)：各需求定位与命令。
- [包索引](../../开发文档/03-workspace-index.md)：实际 package.json 和脚本。

AIRI-026在共享实时语音设置页新增人物卡入口和独立续聊测试。测试只准备口语稿，不连接豆包或启动麦克风；实际准备依赖当前慢脑配置。面板显示安全错误分类与HTTP状态，详见[话痨专题](chatty-conversation.md)。

返回 [Wiki 首页](../README.md)。

2026-10-06，AIRI-028/029：首页固定视觉面板与共用视觉设置显示匹配/质量及补采复核状态，诊断显示近期真实采集速度。共用开发者记忆页显示补采数量与两步批次撤销。共享严格帧接口同时更新服务、Web和三个客户端类型引用。


2026-10-08，AIRI-033：共享实时对话设置增加快慢脑系统提示词业务组件，提供中文默认编辑、保存、草稿恢复和规则预览。
共享包新增prompts契约出口与编辑器组件出口，Web/桌面/移动类型检查通过；当前实际浏览器中文入口已打开。
