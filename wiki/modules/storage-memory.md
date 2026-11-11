# 数据存储与三种记忆

AIRI-046：实时字幕仅在通话拥有者的内存中显示，不参与云同步或个人事实提取。最终转写、音频排空确认及打断保存继续由会话领导窗口执行。预览和保存复用同一消息构造，ID和首次字幕时间保持一致，确认后移除预览，避免重复气泡。浏览器阅读偏好与人物库分开。

核对日期：2026-10-19。范围：开发知识、聊天历史、本地人物与行为记忆。关联任务：AIRI-002、AIRI-011、AIRI-013、AIRI-014、AIRI-025、AIRI-042。

“记住项目”“保存聊天”“认识某个人”使用不同的数据系统。
回答记忆问题时先明确对象，再说明隔离、读取和删除边界。

## 数据落点

| 数据 | 存储位置 | 读取和隔离 |
| --- | --- | --- |
| 项目 Wiki | 工作区 wiki/ | Codex 按问题读文件。不是角色运行时知识输入 |
| 任务和变更 | 项目管理/tasks.json | 本机管理服务，修订冲突检查与上次备份 |
| 模型服务配置 | 浏览器 localStorage + Web 台式机 DPAPI `shared-settings.bin` | Web user provider/提示词/慢脑等按宿主 revision 同步；hosted 认证 provider 不共享，原登录云副本保留原规则 |
| 聊天记录 | IndexedDB airi-local | 会话仓库、账号与角色边界 |
| 人脸归档对象 | 运行时 stage-identity 短租期 | 人物 UUID 仅决定消息归档，不改变登录或舞台会话 |
| 逐消息归属与姓名目录 | IndexedDB airi-local 的消息 archive 与 local:chat/people | 原文不复制；永久 ID 关联人物，确认姓名只更新显示名称 |
| 云同步 outbox | IndexedDB airi-sync-queue | 认证后的原同步路径 |
| 实时语音 Key | airi/.local/realtime-voice.json | 主机网关读取，不进入浏览器配置导出 |
| 人物姓名和相遇 | 本地 vision 数据库 people.sqlite | 持久人物 ID，不用短时 track_id |
| 行为规则与姓名确认 | 同一 SQLite 的 behavior_rules、name_confirmations | 规则进入当前聊天上下文，确认结果控制写库 |
| 本机开发者凭据 | 忽略目录 .local/vision/developer-auth.json | 随机盐与 scrypt 摘要，独立于 hosted 账号 |
| 人脸模板、照片、交流正文 | 同一 SQLite 中的 DPAPI 加密字段 | 当前 Windows 用户解密，正文按人物与角色隔离 |

Windows DPAPI 加密指定字段，不代表整个 SQLite 文件加密。姓名和相遇元数据仍在数据库中。
不要将这些私人数据复制到 Wiki、任务、截图或版本控制。
浏览器来源不同，各自缓存与历史仍分开；AIRI-039 的 Web 配置通过台式机宿主同步，聊天档案和身份不在该配置内。参见[配置同步](shared-config.md)。

## 模型索引隔离

人物档案、照片和交流记忆独立于识别模型。SFace 128 维登记模板继续保留。
recognition_templates 保存 DPAPI 加密的 EdgeFace 512 维特征，按人物、模型 hash 和角度区分。
索引在主机内存解密已有照片后生成。照片 hash 未变化时直接复用加密特征，改名无需重新提取。
不能混用维度、模型版本或 SFace 校准。删除人物同时删除全部模型索引。
本机 recognition.json 选择 EdgeFace S。修改真实数据前保存可恢复备份，备份仍属于私人数据。

## 交流记忆算法

People.remember 按 person、character、event 去重。每条真实交流截取至两千字符。
每个人物与角色最多保留八十条，按时间删除较旧条目。
profile 返回最近八条，供当前有权限的请求做有界引用。
当前是近期交流回忆，不是向量语义检索，也不是训练模型权重。

当前确认人物或同一清晰轨迹新建的匿名人物能接收对应角色记忆。多人、旧观察、人物离开和角色变化阻止旧归属。
姓名纠正后不继续引用错误人物的记忆。
候选姓名先复述确认，纠正后再次确认才更新原 ID 对应的显示名。AIRI-045 在姓名之前保存合格单人脸的匿名 ID、特征与早期交流；具名档案核对期间隐藏旧档案记忆，归档对象通过独立 recipient 保留。
旧档案再次相遇补问一次。照片、模板与原记忆随改名保留，不按姓名新建第二份档案。
用户拒绝记忆或删除档案，会删除人物、照片、模板、交流与相遇记录，并撤销当前学习。

AIRI-042：开发者维护在姓名旁提供全量清除。确认绑定人物 ID，切换人物或角色后失效。主机批准删除后关闭舞台，取消生成、音频和采集，再由会话领导窗口清除当前浏览器 `local-face:<person_id>` 的所有角色会话、索引、待发送、收藏、标签、备注和摘要，撤销当前人物身份及其他窗口缓存。迟到转写无法恢复旧记录。再次登记使用新人物 ID。

存储枚举适配筛出 IndexedDB 当前命名空间并返回相对键，保留原物理存储。此前驱动返回物理前缀，空枚举可能漏删整理信息。测试先证明原数据存在，再验证删除后的消失与其他人物数据保留。

全量清除不按名字搜索并删除未归属陌生人片段，不影响其他人物和行为规则。当前来源之外的浏览器/设备、导出文件和私密备份需分别处理。后台删除和浏览器清理不能跨存储形成原子事务，部分失败明确提示重试，不显示全部完成。

## 管理权限

人物记忆维护、短期模块与数据库/数据页只有本机开发者会话有效时才挂载内容。AIRI-035 的长期记忆聊天档案允许当前账户查看自己的历史，其他人物的档案查询仍刷新并检查开发者会话。
服务端再次检查人物总表、管理读取、改名、正文编辑/删除和手工登记权限，不能靠前端标记绕过。
登录失败五次暂停一分钟，Cookie HttpOnly/SameSite，一小时失效。退出、重启和队列执行前撤权阻止后续管理写入。
性能统计不含私人档案，含姓名观察仅开发者可读。当前清晰单人的对话记忆和本人纠错保留原归属检查。
陌生人聊天入口保留，人脸和姓名不授予开发者或 hosted 权益。
2026-10-28，AIRI-045 取消 AIRI-034 的人脸账户联动。真实认证决定登录和主舞台会话，人脸只更新 `archiveUserId`。人物 UUID 永久保留；无姓名时先归档，确认后补显示名，`unnamed-friend` 行为记忆指导自然询问。
新原文按每条消息的 `archive.personId` 归属；同一舞台会话可以包含多个人物。支持原会话归属与逐消息归属共存，有逐消息归属时优先，否则沿用会话归属，不猜测重标历史。人脸失认、离开或换人不会重置聊天列表。
普通回复沿用原用户，主动问候按当前人物。摄像头派生的文字问候与语音发言都独立捕获归属，避免没有新用户消息时沿用上一人。
人物记忆继续由主机按人物和角色保存，完整原文属于当前浏览器来源，不增加跨设备同步。人脸归属消息不参与 hosted 云同步，普通真实认证记录沿用原同步规则。
全量清除同时处理原人物分区和混合会话中的目标消息与整理，保留其他人的消息及舞台会话。当前窗口租期失效只撤销未来消息归属。设备所有者仍能读取浏览器存储，归档权限不等于设备级加密。
浏览器 IndexedDB 和主机文件仍受设备权限控制，应用登录不能对设备所有者隐藏已存数据。

## 发展边界

聊天历史持久化不等于自动事实提取或长期语义搜索。AIRI-035 增加了[按人物的聊天档案](chat-archive.md)：原文、收藏、备注、标签和摘要共用浏览器持久层，普通模型和慢脑可以检索、展开和整理。快脑引用少量回顾，需要更多历史时委托慢脑。
memory-pgvector 的配置事件目前为空，不能据目录名称声称已接入向量记忆。
若增加长期语义记忆，需设计提取、确认、检索、注入、删除与身份隔离。
当前管理页接入既有近期回忆，未将 memory-pgvector 骨架包装成已实现能力。
无摄像头持久身份、确认后的事实提取、语义索引和跨设备同步见 [建设报告](../../airi/docs/ai/reports/2026-10-05-memory-management.md)。
Wiki 增长是工程知识积累。人物记忆增长是存储新交流。两者都不表示基础模型自动训练或升级。

## 证据

- [storage.ts](../../airi/packages/stage-ui/src/database/storage.ts)：IndexedDB 挂载。
- [chat-sessions.repo.ts](../../airi/packages/stage-ui/src/database/repos/chat-sessions.repo.ts)：会话持久化。
- [session-store.ts](../../airi/packages/stage-ui/src/stores/chat/session-store.ts)：本地与云会话协调。
- [stage-identity.ts](../../airi/packages/stage-ui/src/stores/stage-identity.ts)：归档人物、租期、姓名目录与真实认证身份。
- [config.ts](../../airi/packages/stage-ui/src/stores/providers/config.ts)：服务配置。
- [identity.py](../../airi/services/local-vision/identity.py)：People.remember、profile、delete 和 DPAPI。
- [recognition.py](../../airi/services/local-vision/recognition.py)：模型特征缓存与照片变化处理。
- [memory-pgvector](../../airi/packages/memory-pgvector/src/index.ts)：当前骨架。
- [developer.py](../../airi/services/local-vision/developer.py)：本机权限与管理 API。
- [memory-manager.vue](../../airi/packages/stage-ui/src/components/scenarios/memory-manager.vue)：规则、档案、交流正文与数据库统计。

开发记忆维护见 [维护流程](../maintenance.md)。
返回 [Wiki 首页](../README.md)。

2026-10-06，AIRI-029：face_extensions保存按模型/基础版本/观察批次隔离的DPAPI扩展向量和裁剪。开发者可整批撤销，人物删除同时清除。候选只在worker内存，不保存聊天或云端。新接口及防学习链见[轨迹补采](../algorithms/face-adaptation.md)。


2026-10-08，AIRI-033：快慢脑提示词属于当前浏览器域名配置，localStorage键为settings/realtime-voice/brain-prompts。
它不属于人物记忆、服务端模型密钥或共享云历史。不同设备/域名各自保存，修改不会写入任务或模型私有推理。

AIRI-041保持姓名候选与持久档案分离。重复邀请不能抹掉同轨迹确认或拒绝，新增Python回归用临时SQLite和DPAPI验证真实保存。没有读取或修改用户实际人物库，也没有增加个人画像或云记录。
