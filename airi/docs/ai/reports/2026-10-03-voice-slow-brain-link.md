# 语音快脑与联网慢脑联动修复

日期：2026-10-03。任务：AIRI-021。报告使用中文。

用户反馈：语音问南宁天气，快脑直接说没有联网权限；文字查询出现后台任务完成和联网回答。首页左上角组件名称是“快慢脑协作”面板，显示对话与后台任务状态。

## 原因与修复

文字入口直接提交BrainRuntime任务；语音先由豆包决定是否调用spawn_thinking。两者并非相同派发路径。快脑原来只得到通用后台工具说明，没有当前慢脑web_search能力信息；豆包自身原生搜索又固定关闭，因此存在直接拒绝而未派发的缺口。另一个确定的代码缺陷是：session.tools只按通话启动时的slowBrain生成，后续context仅更新instructions，模型配置变化无法同步活动通话。

先加复现测试，确认启动提示缺失web_search、活动context未带slowBrain的2项浏览器失败，以及活动session.tools不更新的1项网关失败。修复后：

- slow-brain从实际模型选择、web-search.configured及实际lastFailure生成ThinkingCapabilities。无Key，状态为enabled/disabled/blocked。它表示配置，不能冒充查询成功。
- 快脑启动和活动更新都读取当前能力。搜索启用时，要求模型原生调用spawn_thinking做在线查证；不能因自己的native search关闭，声称整个智能体无联网权限。历史拒绝不覆盖新配置。
- Eventa context同时带instructions和必需slowBrain，豆包完整session.update重算tools，保留model/audio/extension和连接。配置、服务错误及恢复同步活动通话；队列去重以待发送状态为准，避免快速切换残留旧状态。
- 首页显示实际慢脑联网状态及网络搜索设置入口。受理、执行、完成、发言、实际送达仍是不同状态。

语音链路：麦克风→豆包最终转写与函数调用→立即任务回执→已配置慢脑/core-agent→模型web_search工具轮次→实际工具结果及来源→当前任务结果上下文→用户不说话且播放空闲700ms→豆包朗读suggested_utterance→音频结束且本地排空→已反馈。

没有按天气关键词自动派发、模拟天气答案、伪造来源、开启豆包原生付费搜索或新增第三个模型。文字查询的“今年”与语音查询的“今天”不同；文字任务成功也不证明获得了实时气象观测。

## 执行验证

| 检查 | 实际结果 |
| --- | --- |
| 实时语音包Node测试 | 4文件、22项通过，含活动工具启停、会话所有权、完整更新、版本、取消与音频 |
| 语音/搜索浏览器测试 | 6文件、44项通过，真实Vue/Pinia/DOM；厂商传输、模型和搜索HTTP边界为测试响应 |
| 搜索工具解析与本机HTTP网关 | 2文件、12项通过 |
| 根级typecheck | 55任务成功 |
| 根级lint | 0错误、603项已有警告 |
| i18n、实时网关、Web构建 | 退出0 |

共78项相关回归通过。语音闭环测试包含最终用户转写、快脑工具回执、真实生成适配器两轮工具执行、工具来源进入evidence、对话中不抢话、空隙朗读，以及播放排空后才写入事实/标记已反馈。另一项用搜索HTTP 403测试实际错误→blocked投影→手动重试→enabled→停用→disabled，界面与快脑同步。

额外执行session-store.browser.test.ts，5项失败在airi-card的useI18n初始化，未进入语音或搜索逻辑；单独执行仍失败。已有AIRI-012跟踪挂载/模拟边界问题，本轮未改该测试或通过删除断言隐藏它。首次语音测试遇浏览器音频未解锁超时，改为真实点击解锁后重跑通过。上述失败日志保留在忽略的.runtime目录。

测试浏览器显示未配置慢脑；没有复制或虚构用户DeepSeek Key。这些自动测试不证明真实豆包会选择函数调用、真实DeepSeek执行质量或真人音频往返。本轮不能声称真人验收已完成，AIRI-004继续跟踪。此前AIRI-020的真实Firecrawl查询证据单独保留。

## 复现与部署

工作区先初始化scripts/airi-env.ps1，使用已有Node/pnpm和.tools/playwright。

```powershell
# airi/packages/realtime-voice
& $AiriNode ../../node_modules/vitest/vitest.mjs run
# airi根目录
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $AiriWorkspace '.tools/playwright'
& $AiriNode ./node_modules/vitest/vitest.mjs run --config packages/stage-ui/vitest.config.ts --project browser src/stores/modules/realtime-brain.browser.test.ts src/stores/modules/realtime-audio.browser.test.ts src/stores/chat/voice-transcript.browser.test.ts src/tools/web-search.browser.test.ts src/tools/firecrawl-search.browser.test.ts src/stores/modules/web-search.browser.test.ts
& $AiriNode ./node_modules/vitest/vitest.mjs run --config packages/stage-ui/vitest.config.ts --project node src/stores/ai/chat-llm/tool-resolver.test.ts src/tools/web-search-gateway.test.ts
& $AiriNode $AiriPnpm --config.verify-deps-before-run=false typecheck
& $AiriNode $AiriPnpm --config.verify-deps-before-run=false lint
& $AiriNode $AiriPnpm --config.verify-deps-before-run=false -F @proj-airi/i18n build
& $AiriNode $AiriPnpm --config.verify-deps-before-run=false -F @proj-airi/realtime-voice build
& $AiriNode $AiriPnpm --config.verify-deps-before-run=false -F @proj-airi/stage-web build
```

修改网关需构建并重启实际5173 Vite服务。用户结束旧通话，刷新自己的已配置浏览器再开始；面板应显示慢脑联网搜索已启用，语音查询应出现后台任务，来源来自web_search，播放完成才已反馈。若服务失败，应显示实际错误，不能泛称没有联网权限。配置仍按当前浏览器/域名保存。
本轮已核实实际Vite进程后重启，首页HTTP 200；浏览器确认新增“语音联网查询需要先配置慢脑模型”与网络搜索设置入口。截图为测试浏览器当前未配置状态，保存在工作区.runtime/voice-slow-link-state.png，不代表用户自己浏览器的模型配置。未修改用户凭据或开关。

任务账本记录代码、部署、索引同步和Wiki检查。本地日志与截图仅在忽略的.runtime目录，不记录Key或私人对话。
