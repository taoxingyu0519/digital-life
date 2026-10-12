# 数据存储与三种记忆

核对日期：2026-10-05。范围：开发知识、聊天历史、本地人物与行为记忆。关联任务：AIRI-002、AIRI-011、AIRI-013、AIRI-014、AIRI-025。

“记住项目”“保存聊天”“认识某个人”使用不同的数据系统。
回答记忆问题时先明确对象，再说明隔离、读取和删除边界。

## 数据落点

| 数据 | 存储位置 | 读取和隔离 |
| --- | --- | --- |
| 项目 Wiki | 工作区 wiki/ | Codex 按问题读文件。不是角色运行时知识输入 |
| 任务和变更 | 项目管理/tasks.json | 本机管理服务，修订冲突检查与上次备份 |
| 模型服务配置 | 浏览器 localStorage | 来源隔离，登录后含云副本同步逻辑 |
| 聊天记录 | IndexedDB airi-local | 会话仓库、账号与角色边界 |
| 人脸关联的本地账户 | 运行时 stage-identity 短租期 | 姓名用于显示，local-face:人物ID 用于会话隔离。身份不持久登录 |
| 云同步 outbox | IndexedDB airi-sync-queue | 认证后的原同步路径 |
| 实时语音 Key | airi/.local/realtime-voice.json | 主机网关读取，不进入浏览器配置导出 |
| 人物姓名和相遇 | 本地 vision 数据库 people.sqlite | 持久人物 ID，不用短时 track_id |
| 行为规则与姓名确认 | 同一 SQLite 的 behavior_rules、name_confirmations | 规则进入当前聊天上下文，确认结果控制写库 |
| 本机开发者凭据 | 忽略目录 .local/vision/developer-auth.json | 随机盐与 scrypt 摘要，独立于 hosted 账号 |
| 人脸模板、照片、交流正文 | 同一 SQLite 中的 DPAPI 加密字段 | 当前 Windows 用户解密，正文按人物与角色隔离 |

Windows DPAPI 加密指定字段，不代表整个 SQLite 文件加密。姓名和相遇元数据仍在数据库中。
不要将这些私人数据复制到 Wiki、任务、截图或版本控制。
浏览器来源不同，配置和历史不自动共享。笔记本与主机浏览器有各自存储。

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

只有当前确认人物能接收对应角色记忆。多人、旧观察、人物离开和角色变化阻止旧归属。
姓名纠正后不继续引用错误人物的记忆。
候选姓名先复述确认，纠正后再次确认才更新原人物 ID。未确认阶段不采集登记模板，不投影旧档案记忆。
旧档案再次相遇补问一次。照片、模板与原记忆随改名保留，不按姓名新建第二份档案。
用户拒绝记忆或删除档案，会删除人物、照片、模板、交流与相遇记录，并撤销当前学习。

## 管理权限

人物记忆维护、短期模块与数据库/数据页只有本机开发者会话有效时才挂载内容。AIRI-035 的长期记忆聊天档案允许当前账户查看自己的历史，其他人物的档案查询仍刷新并检查开发者会话。
服务端再次检查人物总表、管理读取、改名、正文编辑/删除和手工登记权限，不能靠前端标记绕过。
登录失败五次暂停一分钟，Cookie HttpOnly/SameSite，一小时失效。退出、重启和队列执行前撤权阻止后续管理写入。
性能统计不含私人档案，含姓名观察仅开发者可读。当前清晰单人的对话记忆和本人纠错保留原归属检查。
陌生人聊天入口保留，人脸和姓名不授予开发者或 hosted 权益。
2026-10-09，AIRI-034 将确认人物关联到独立的本地聊天账户。人物仍使用原 SQLite ID，不按姓名另建档案。
会话采用 `local-face:<person_id>` 分区，离开切回 `local`，再次识别恢复原分区。改名不改变分区。
人物记忆继续由主机按人物和角色保存，聊天历史仍属于当前浏览器来源，不增加跨设备同步。
相机账户的云同步入口全部关闭，即使浏览器同时保存原 hosted 凭据，也不能把本地人物记录当作云端账号上传。
当前窗口或同步租期失效后回到陌生人。设备所有者仍能读取浏览器存储，身份隔离不等于设备级加密。
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
- [stage-identity.ts](../../airi/packages/stage-ui/src/stores/stage-identity.ts)：确认人物、租期和本地账户键。
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
