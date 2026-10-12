# 快慢脑联网能力核对

日期：2026-10-03。任务：AIRI-017。范围：当前源码、实际工具接线与厂商公开 API 文档。

## 已确认结论

当前项目没有在选择 DeepSeek 时自动启用联网。快脑和慢脑的搜索入口互相独立。

| 链路 | 当前实现 | 联网条件 |
| --- | --- | --- |
| 豆包 Seeduplex 快脑 | `doubao.ts` 在顶层 `extension.dialog.extra` 固定发送 `enable_volc_websearch: false` | 原生搜索尚未接入设置。官方要求开启搜索、选择服务类型并提供独立搜索 API Key |
| DeepSeek 慢脑 | DeepSeek provider 提供 `chat`，`getGenerationProvider` 将其映射到 Chat Completions | 官方此接口只支持应用提供的函数工具，不自动执行网页搜索 |
| 慢脑应用搜索工具 | `resolveLlmTools` 挂载 Tavily 支持的 `web_search` | `enabled` 为真且 Tavily Key 去除空白后非空 |
| 纯文字入口 | 已选慢脑时，`use-chat-input` 直接进入后台任务 | 不连接豆包。快脑的原生搜索不会自动成为慢脑工具 |

`slow-brain.ts` 没有主动移除 Web 搜索。它只显式排除 MCP 内置、调试与 Spark 工具，仍使用搜索工具默认解析分支。
默认搜索设置为关闭且 Key 为空。仅配置 DeepSeek，不满足搜索工具挂载条件。
运行时另有 `activeTools` 扩展入口。扩展实际提供的工具须独立核对，不能假定不存在。

因此，前一轮快慢脑接入完成了模型、工具执行与结果投递，但没有完成豆包原生联网配置。
模型能发起 HTTP 对话请求，不等于模型拥有网页检索工具。
模型回答“不能联网”也不能单独证明网络故障，须核对请求工具列表和真实搜索执行。

## 官方依据

人工读取了以下官方页面，核对日期同上。

- [豆包全双工实时语音 API](https://docs.volcengine.com/docs/DoubaoVoice/endtoend-realtime-voice-full-duplex-version?lang=zh)：搜索默认关闭，提供 `enable_volc_websearch`、`volc_websearch_type` 与 `volc_websearch_api_key`。搜索需在搜索服务控制台开通，语音凭据不替代搜索凭据。
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion)：`tools` 当前只支持函数。函数参数由模型生成，执行与结果回传由应用完成。
- [DeepSeek Responses API](https://api-docs.deepseek.com/guides/responses_api)：内置 `web_search` 类型被忽略。因此切换协议并添加同名字段，也不证明搜索已执行。
- [DeepSeek Anthropic API](https://api-docs.deepseek.com/guides/anthropic_api)：输入内容支持 `server_tool_use` 和 `web_search_tool_result`。输入类型兼容不证明此项目发起了服务端搜索。项目 DeepSeek provider 未使用该协议。

以上结论针对当前官方文档与项目的 DeepSeek provider。
第三方托管 DeepSeek、火山方舟与兼容代理的搜索能力需要核对其接口，不能由模型名称推断。

## 源码证据

- [豆包会话参数](../../../packages/realtime-voice/src/doubao.ts)：搜索固定关闭，全量更新保留该参数。
- [DeepSeek provider](../../../packages/provider-inference/src/providers/cloud/deepseek/index.ts)、[协议映射](../../../packages/provider-inference/src/types.ts)：Chat Completions 路由。
- [慢脑执行](../../../packages/stage-ui/src/stores/modules/slow-brain.ts)：调用真实工具解析器并保存实际执行证据。
- [搜索设置](../../../packages/stage-ui/src/stores/modules/web-search.ts)、[工具解析](../../../packages/stage-ui/src/stores/ai/chat-llm/tool-resolver.ts)：开关与非空 Key 的共同门控。
- [搜索执行](../../../packages/stage-ui/src/tools/web-search.ts)：真实请求 `https://api.tavily.com/search`，不使用模型自述替代搜索。

## 本轮验证与限制

初始化命令：`. ./scripts/airi-env.ps1`。以下 Vitest 命令从工作区根目录执行。

| 检查 | 结果 | 证明范围 |
| --- | --- | --- |
| `$AiriNode ./airi/node_modules/vitest/vitest.mjs run --config ./airi/packages/provider-inference/vitest.config.ts --project node ./airi/packages/provider-inference/src/providers/cloud/deepseek/index.test.ts` | 4 项通过，退出 0 | 模拟凭据验证 DeepSeek 配置投影，不调用模型服务 |
| `$AiriNode ./airi/node_modules/vitest/vitest.mjs run --config ./airi/packages/stage-ui/vitest.config.ts --project node ./airi/packages/stage-ui/src/stores/ai/chat-llm/tool-resolver.test.ts` | 6 项通过，退出 0 | 模拟搜索服务验证未配置时不挂载、配置后挂载与 Key 去空白 |
| 仓库 `pnpm lint` | 退出 0，0 错误，603 个已有警告 | 未修改生产代码，未改写已有警告 |
| 官方文档读取 | DeepSeek 三页 HTTP 200，豆包浏览器页面读取成功 | 公共接口说明，不证明实际账户权限和余额 |

首次受限环境运行 Vitest 因 Windows 子进程限制未启动，授权环境重跑通过。
本轮没有取得用户刚才那轮对话的请求日志，也没有确认用户浏览器中的服务来源和搜索设置。
检查用的独立浏览器页面未选择慢脑，不能用它否定用户已配置的另一页面。
没有用真实账户调用搜索，没有改动 API Key、付费服务、搜索开关或模型提示词。

## 后续接线要求

接入豆包原生搜索需要完整设置、服务器端搜索凭据保存、会话全量参数更新和真实搜索验收。
让 DeepSeek 慢脑联网需要一个实际可执行的搜索工具，或一个经验证支持服务端搜索的托管接口。
搜索必须留下实际调用状态、来源与错误证据。提示词、关键词路由和过渡话术不能代替检索。
已配置服务仍不能查询时，核对真实请求是否包含工具，以及是否发生工具执行、401、余额限制或超时。

本轮完成原因调查与文档纠正，未把联网接入标记为完成。
