# Doubao fast brain with an asynchronous background worker

Status: Implemented under AIRI-016. Real model service acceptance remains under AIRI-004.

## Context

The user requests continuous Doubao Seeduplex conversation while a slower model
thinks, reads records, or runs tools. The existing local realtime path does not
delegate work. Local text composers always select the ordinary chat model and
fail with `No active chat provider or model configured` when only Doubao is set.

The design follows Qwen Audio Agent's frontend, code orchestration runtime, and
background worker. It does not import that server or add a coordinating model.
The user supplied `豆包实时语音3快慢脑整理文档.md`; protocol details were checked
against the official Doubao full-duplex documentation and current Qwen adapter.

## Decision

- Keep Doubao as the fast conversational model. Add `spawn_thinking`, task status,
  and version-specific cancellation through its native function-calling batches.
- Own one bounded source of confirmed user input and delivered assistant output.
  Project recent facts/results to the fast model; give the worker relevant facts,
  current authorized context, character and guest identity. Do not share private
  reasoning or database output as a growing common prompt.
- Return task acceptance immediately. Run a FIFO worker with at most eight active
  or undelivered tasks and a 90-second timeout. Use the selected Consciousness
  provider through core-agent with abort support and existing authorized tools.
- Supply a read-only current-conversation lookup tool. Add no external database,
  new account, model key, paid service, or default desktop action permission.
- Stamp results with task ID/version. Validate structured status, summary,
  suggested utterance and delivery policy. Evidence comes from actual tool output
  and provider citations, not a model-authored provenance field.
- Publish current results to context first. Grant speech separately after 700 ms
  of conversation idle, with no user speech, response or queued audio. `immediate`
  means eligible at the next safe slot; `context_only` remains silent.
- Acknowledge voice delivery after the provider audio-end event and local playback
  drain. Keep interrupted output out of shared facts. The protocol cannot reliably
  align a partially heard prefix, so exclude the entire interrupted sentence.
  Text output is confirmed when displayed; text mode captures and plays no audio.
- Abort only explicit task revisions/cancellation or session lifecycle changes.
  Continued casual conversation does not invalidate work. Reject old versions and
  late output even when a provider ignores cancellation. Already started external
  tool side effects cannot be rolled back by an abort.
- End runtime tasks on hangup, hidden page, navigation, identity/character/session
  change, deletion or generation change. Store no durable task queue or raw results.
- Route typed requests to the selected worker and shared task runtime when
  enabled, or while a voice session is active. Local text mode uses no microphone
  or upstream voice session. Voice mode reads the worker result through Doubao.
  Preserve the draft on failure and explain that a text model must be selected.
  Images and ordinary generation keep their existing model path.

## Protocol decisions

Proactive/result speech uses `speech_text_buffer.commit` to read the supplied
utterance exactly. Real service tests showed audio events only, without
`response.output_text` or a conversational answer. Qwen maps interactive text to
this event, but that mapping cannot satisfy typed questions on this API. The
worker handles typed requests instead. Known TTS text is emitted locally, while
audio-end and playback drain still determine delivery. Historical context-only user and
assistant pairs use `conversation.item.create`. No upstream `response.create`
event is sent. Function calls arrive in `items`; correlated tool returns share
one `conversation.item.create` batch. Every full `session.update` retains model,
audio, tools, and top-level `extension`. Voice keeps microphone input active
during work. The supported mute event is `input_audio_mute.commit`; local text
mode needs no voice connection. Closing waits for `session.closed`.

Some supplied summary examples nested `extension` under `session`; this conflicts
with the official payload and was not adopted. Saving settings does not establish
service access, billing authorization, or compatibility with every model version.

## Consequences and verification

The code runtime owns scheduling and speech slots. Model tool selection and the
quality of summaries still depend on actual models; prompt rules do not prove
every delegated objective will be interpreted correctly. The task panel provides
versions, summaries, sources, cancellation and clear model-configuration state.

Gateway tests use a simulated upstream with real WebSocket connections. Browser
tests use real Pinia stores, core-agent streaming/tool execution, and DOM; only
service boundaries are simulated. Audio lifecycle tests use a real AudioWorklet.
Executed commands and remaining real-service checks are recorded in
[the validation report](../reports/2026-10-02-fast-slow-brain.md).

## References

- [Qwen Audio Agent](https://github.com/QwenAudio/qwen-audio-agent)
- [Qwen architecture](https://qwenaudio.github.io/qwen-audio-agent/architecture/deep-dive)
- [Doubao full-duplex API](https://docs.volcengine.com/docs/DoubaoVoice/endtoend-realtime-voice-full-duplex-version?lang=zh)
- [Doubao access guide](https://docs.volcengine.com/docs/DoubaoVoice/access-mustread?AuditDocumentID=397063&lang=zh)
