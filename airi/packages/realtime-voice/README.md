# Realtime voice

## 转写与消息关联

AIRI-046按响应范围关联助手文本，允许不同轮次重复相同短回答。VAD先到、ASR item ID晚到时，显示ID和provider item ID分别管理，防止覆盖前一条消息。Stage UI提供独立临时字幕，持久化和确认事实继续等待原最终转写或音频排空规则。详见工作区中文交付报告。

Local Web integration for Doubao Seeduplex realtime voice 3.0. This package owns
browser audio, a validated Eventa channel, the Node WebSocket gateway, and a
bounded fast/slow brain task runtime. The frontend model handles conversation;
the configured text model handles background reasoning and authorized tools.

## Run and configure

Run `pnpm -F @proj-airi/realtime-voice build`, then start `stage-web` as usual.
Open **Settings → Modules → Realtime conversation**, save a Doubao realtime voice
API key and return to the stage. **Start call** opens a voice session with
microphone permission. Select a provider and model in **Consciousness** for
background work and typed requests. **Use background tasks and shared context
for typed messages** opens a local text session without microphone capture,
playback, or a Doubao connection. Text results appear in chat; during a voice
call Doubao reads the worker result aloud. Saving either configuration does not
verify the actual model service.
This integration supports the local Vite development server and Vite preview.
Static hosting, Electron, and Pocket do not include this gateway.

Defaults: model `1.2.6.1`, voice `zh_female_vv_jupiter_bigtts`, resource
`volc.speech.dialog`. A text-model key does not necessarily authorize this service.
Saving configuration does not validate billing, entitlement, or the upstream API.

## Source map

| File | Responsibility |
| --- | --- |
| `contracts.ts` | Valibot command/event schemas and Eventa channel |
| `brain.ts` | Conversation facts, FIFO background tasks, versions and delivery acknowledgements |
| `conversation.ts` | Selected model conversation policies and lossless canonical result chunking |
| `client.ts` | Same-origin browser WebSocket and configuration requests |
| `audio.ts` | Microphone lifetime, PCM playback, mute and interruption |
| `capture.worklet.ts`, `pcm.ts` | Resampling to 16 kHz PCM16, 20 ms frames |
| `gateway.ts` | Loopback/origin checks, local credentials, one call at a time |
| `doubao.ts` | Upstream headers, session setup, transcripts and cancellation |
| `vite.ts` | Development/preview gateway lifecycle and private file exclusion |

The `stage-ui` realtime store passes the active character prompt, guest/account
identity and bounded recent text history. Final transcripts use the synchronized
chat action with user, character, session and generation checks. Audio feeds the
existing stage analyser and lip sync. Regular ASR is suspended during a call.
The realtime model generates and speaks its own answers. It can delegate through
`spawn_thinking`, read task status, or cancel a named version. These tools return
immediately. `stage-ui/stores/modules/slow-brain.ts` calls the existing core-agent
generation adapter and authorized tools, including current-conversation record
lookup. It adds no coordinating model, external database, or separate TTS.
Results include task identity/version, status, confirmed summary, runtime evidence,
suggested utterance and delivery policy. Context update and speech delivery are
separate. Results wait for a quiet slot, including those marked `immediate`.
The application schedules one random acceptance after a quiet 200 ms and the
result after 700 ms. Completed work skips acceptance. Pending result text stays
out of model context to avoid two output paths; delivered and context-only
results remain available as shared context. Tool handoff releases generation.
User changes revise or cancel a task; casual conversation does not cancel it.
Conversation styles enter actual fast instructions and worker requests. Natural
mode permits one truthful waiting notice per task version after about 15 seconds
in an idle slot; other styles omit it. This is an engineering check, not a
universal silence threshold. Progress comes from runtime and tool events.
Both text and speech use the canonical `result_summary`; `suggested_utterance`
is only a preview. Speech splits the summary without rewriting it. Interrupting
a result pauses delivery while work continues. The UI or a user-requested
`set_agent_delivery` call resumes unconfirmed chunks. Confirmed chunks are not
repeated. These constraints do not verify the factual truth of a model summary.
Only delivered assistant output becomes shared facts. Interrupted voice output
is excluded in full because the protocol does not provide exact playback alignment.
Text output is confirmed when displayed. Runtime tasks end with their session.
Fresh local visual text and bounded personal memories enter live instructions through `session.update`.
The provider receives no camera images through this voice channel.
Active mode can open one configured call when a person appears. It ends after thirty seconds without a visible person.
Manual hangup and the ten-minute limit do not trigger an automatic reconnect during the same encounter.
Companion speech uses the official `speech_text_buffer.commit` event. It creates no invented user turn.
Final user transcripts feed local introduction learning. Vision-derived assistant transcripts stay out of cloud sync and later history.

## Protocol and lifecycle

AIRI-024新增“活泼话痨”风格，沿用当前人物卡。达到用户设置的安静时长后，已选慢脑通过应用事件准备短稿，豆包使用现有队列朗读。等待默认5秒，支持1–120秒及5/10秒快捷设置。用户不必回应，正式任务和插话优先。输入不伪造用户消息，不挂载工具。AIRI-026改为纯口语稿、400字符上限、单独非思考请求和45秒超时；每通话最多30次准备请求，失败后停止自动重试。UI和现有`set_agent_delivery`支持暂停/继续，人物/会话/模型切换及挂断丢弃旧稿，实际播放完才记录事实。AIRI-027区分观察刷新与授权/相遇变化，前者不再取消续聊；只按已听片段为模型安排两段轻试探机会，之后换话题，真实用户输入重置。情绪和话题匹配由模型结合上下文判断，沉默不形成长期画像。原10分钟限制保留，纯文字不自动续聊。中文验证见[等待与反思报告](../../docs/ai/reports/2026-10-06-chatty-idle-and-reflection.md)。

Browser → gateway uses `/api/realtime-voice`. The gateway connects only to
`wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue`, supplying the key
in `X-Api-Key`. Input is 640-byte PCM16 frames; output explicitly requests
24 kHz mono `pcm_s16le`. Capture is forwarded only after `session.created`.
No fallback interprets float PCM as integer PCM or silently switches protocols.
Result delivery uses the official `speech_text_buffer.commit` TTS path. Live
testing showed that Qwen's mapping of user text to this event returns audio only,
not a conversational text answer. Typed queries therefore use the selected
worker, not that mapping. Known TTS text is recorded locally and confirmed after
playback. Context-only paired history uses
`conversation.item.create`. The gateway never invents `response.create`.
Provider `items` batches receive matching tool `call_id` results together;
duplicate calls are ignored. `session.update` retains the full session, tools,
audio configuration, and top-level `extension`. Voice sessions keep listening
while background tasks run. The protocol supports mute when audio input stops.
Close waits for `session.closed` with a bounded timeout.
The `speak` command includes an application ID. Real provider `chat_tts_text`
audio starts map their response ID to it; chunks and matching ends carry
`speechId`. An uncorrelated `response.done` cannot confirm speech. Duplicates,
cancelled streams and old ends cannot complete a new result. Playback uses a
short scheduling window and a bounded three-minute backlog; a normal burst
over ten seconds no longer ends the call. Interrupt and mute clear both queues.

Calls end on hangup, socket failure, navigation, hidden document, identity/role/
session changes or the ten-minute limit. Interruption cancels queued playback.
Connection setup and local configuration requests have timeouts. Backpressure
ends a stalled call rather than accumulating audio indefinitely.

The key is stored in the repository's ignored `.local/realtime-voice.json`.
Status responses never include the key. This is a local plaintext credential,
not an encrypted vault; filesystem access to the project can read it. Vite denies
HTTP access to `.local`. Use the module's **Delete local key** button to remove it;
browser data export/reset does not manage this server file. Do not publish this
gateway or add a generic upstream URL field without a separate security design.

## Verification

```sh
pnpm -F @proj-airi/realtime-voice test:run
pnpm exec vitest run --config packages/stage-ui/vitest.config.ts --project browser src/stores/modules/realtime-brain.browser.test.ts src/stores/modules/realtime-audio.browser.test.ts src/stores/chat/voice-transcript.browser.test.ts
pnpm typecheck
pnpm lint
```

Gateway tests use two real local WebSocket connections and a simulated provider;
they do not send a paid request. Browser audio tests use a synthetic media stream
and a real AudioWorklet. A short real-service probe verified greeting audio,
not text query support. Full voice/FC compatibility and perceived audio quality
still require a microphone and configured slow-model trial.

See [the architecture decision](../../docs/ai/adr/2026-10-02-fast-slow-brain.md)
and [the validation report](../../docs/ai/reports/2026-10-02-fast-slow-brain.md).

AIRI-028将首次摄像头问候接入同一准备与发声槽位，周期性摄像头闲聊仍让位。
问候使用greeting应用事件，排空才保存一条历史，不推进无回应试探阶段。
视觉scope变化只取消已捕获上下文的草稿及自动音频，保留未开始的空闲截止时间。用户活动与生命周期仍取消等待。


## 可编辑工作规则

AIRI-033新增`./prompts`公开契约：中文默认规则、完整设置schema及后台输出格式。
浏览器共享store保存经过校验的快照，快脑、慢脑和问候/续聊读取同一来源。
用户可编辑行为，程序继续执行结构输出、工具权限及单一发声调度。
见[提示词ADR](../../docs/ai/adr/2026-10-08-brain-prompt-editor.md)。

AIRI-041新增speech可编辑语音偏好，默认同时不超过三句、三十字，用户明确要求详细时例外。
实际请求在已有角色/风格规则后附加该偏好，不覆盖用户保存的提示词。
这是生成指导，不能代替工具schema、播放状态或强制长度控制。
