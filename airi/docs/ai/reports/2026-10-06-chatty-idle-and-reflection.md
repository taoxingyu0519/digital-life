# 自动找话题、等待设置与无回应调整

日期：2026-10-06。任务：AIRI-027。范围：当前快慢脑运行时、视觉投影和共用前端。

## 已确认原因

旧续聊把视觉观察全文不变当成有效条件。`projectObservation`的`observed_at`随帧变化，物体和动作也会刷新。
`updateVisualContext`会因此中止在途稿件，`composeContinuation`返回前又会因全文变化拒绝结果。
这能导致自动准备一直被取消，或被显示为生成失败；不是联网权限不足的证据。
先添加仅改测试的复现：模型准备中刷新同一相遇的观察，预期不中止，实际请求signal已被abort。修复前1项失败，修复后通过。
用户那一轮的完整事件未取得，不能保证其全部症状都由这一个原因造成。

## 实际改动

视觉注册提供观察投影与scope两个入口。scope包含会话/人物卡、采集来源、权限和主人物/姓名状态，不含帧时间和动作。
同一范围内普通刷新保留在途稿件，也不重置已有安静计时。新请求读取新观察。
撤回观察、权限变化、相遇变化、模型/人物/会话切换仍取消旧候选。准备边界发现失效视为取消，重新按配置等待，避免误称模型服务失败。

等待从硬编码2秒改为默认5秒，设置页支持5/10秒快捷按钮、1–120秒整数滑块和浏览器持久化。
修改立即重排未开始的等待，保留正在准备的有效稿件。用户发言、原生响应、播放和正式任务继续优先。
设为5秒意味着安静5秒后开始准备，模型请求及语音播放额外耗时；不承诺5秒内发声。

模型同时收到当前人物、确认会话和`continuation_state`：先开场分享，最多两段轻试探机会，然后换新话题并展开。
已有真实用户输入时，直接进入针对最近话题的反思机会。新用户转写清零，打断稿件不占已听机会。
计数只在匹配音频结束、本地队列排空、未静音和发言仍属于原用户轮次时推进。
模型私下评估措辞是否冒犯、主题是否不合，也考虑用户在倾听或忙碌。它们是可能性，不是情绪结论。
模型自行生成自然的试探或选择直接分享，程序不按关键词判断用户心情，不输出内部分析、不保存沉默推断。
两次是试探机会预算，不能证明模型实际问了两次或每次都遵守提示。真人措辞质量仍待验收。

面板与门控使用同一状态，分别显示倒计时、倾听、等待播放、任务优先、准备、配置缺失和安全错误。
播放与活动结果改为响应状态，避免结果送达后显示门控滞留。回归覆盖任务播报后恢复续聊。
扩大策略后，长人物卡、事实与8任务会超过网关16000字符限制。组合器优先保留策略及有效事实/任务JSON，再分配人物和视觉空间；回归验证结构完整与总长度。

## 验证

命令均由`scripts/airi-env.ps1`初始化的现有Node/pnpm运行，没有添加依赖、账户或付费服务。

| 检查 | 结果 | 证据边界 |
| --- | --- | --- |
| Vitest browser：realtime-brain、companion、realtime-audio、local-vision、voice-transcript | 5文件43项通过 | 真实Vue/Pinia/DOM；模型、语音传输和设备边界模拟 |
| realtime-voice包Vitest | 5文件26项通过 | 协议、运行时、PCM和投递，不证明厂商账户 |
| stage-ui node：chat.contract.test.ts | 32项通过 | 普通聊天投影与历史边界 |
| `pnpm typecheck` | 55/55任务通过 | 共享接口及三个客户端编译检查 |
| `pnpm lint` | 退出0，0错误、603个既有警告 | 没有忽略新错误 |
| i18n与realtime-voice构建 | 退出0 | 中文文案和网关包产物 |
| stage-web构建 | 退出0 | 网页产物，不代表实际模型完成 |
| 实际设置页 | 5/10秒切换成功，刷新仍为10秒 | 验证浏览器持久化，随后恢复原风格和默认等待 |
| Wiki与源码索引 | 34篇人工复核通过，0待复核、0错误；72包、5547源码条目 | 知识核对和目录清单，不替代功能验证 |

测试覆盖正常刷新不断稿、非空观察下相遇变化中止、视觉撤回、5/10秒准确启动、插话取消、已听阶段推进、打断不计数、用户转写归零、正式任务优先及播放排空。

在`airi/`执行的验证入口如下，浏览器测试另设置已有`PLAYWRIGHT_BROWSERS_PATH`：

```powershell
pnpm typecheck
pnpm lint
pnpm -F @proj-airi/i18n build
pnpm -F @proj-airi/realtime-voice build
pnpm -F @proj-airi/stage-web build
node node_modules/vitest/vitest.mjs run --config packages/stage-ui/vitest.config.ts --project browser packages/stage-ui/src/stores/modules/realtime-brain.browser.test.ts packages/stage-ui/src/stores/companion.browser.test.ts packages/stage-ui/src/stores/modules/realtime-audio.browser.test.ts packages/stage-ui/src/stores/local-vision.browser.test.ts packages/stage-ui/src/stores/chat/voice-transcript.browser.test.ts
node node_modules/vitest/vitest.mjs run --config packages/stage-ui/vitest.config.ts --project node packages/stage-ui/src/stores/chat.contract.test.ts
```

实时包测试在`airi/packages/realtime-voice/`运行`node ../../node_modules/vitest/vitest.mjs run`。
单请求45秒、每通话30次准备及10分钟限制保留。失败仍需明确重试，文字模式不自动续聊。

## 实际服务边界与使用

本轮可操作的Codex浏览器显示慢脑未配置，独立短稿测试按钮禁用。没有更改模型、读取密钥或复制其他设备配置。
因此没有完成真实DeepSeek生成、豆包连续朗读与真人麦克风插话验收，不能把模拟上游测试写成用户真实完整链路成功。
界面截图只含公开配置说明，位于忽略的`.runtime/airi027-topic-settings.jpg`。

用户设备刷新页面后，进入“实时对话 → 活泼话痨”设置等待时间，先用已有慢脑测试续聊准备，再返回舞台开始语音通话。
未启动时以面板实际状态定位：未配置、正在听、播放未完、任务未交付或错误。等待配置与生成耗时分开看。
本机5173网页服务已按进程路径核实后重启，设置路径HTTP200。服务可达不证明模型完成。最后阶段分支改为明确条件后，stage-ui类型检查和对应文件lint再次通过。
Wiki、目录同步和任务验证已记录到AIRI-027账本。真实模型与真人链路继续由AIRI-004验收；历史报告保留原证据边界。
