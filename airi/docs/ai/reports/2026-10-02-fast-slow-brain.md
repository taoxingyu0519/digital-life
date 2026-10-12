# Fast and slow brain validation

Date: 2026-10-02, Asia/Shanghai. Task: AIRI-016. Scope: local Web integration.

## Result and limits

Doubao handles live voice conversation and delegates native tool calls to the
local task runtime. The selected Consciousness model runs background reasoning,
authorized tools, and current-conversation record lookup. Facts, task versions,
context updates and playback acknowledgements are separate. Frontend controls
show tasks, revisions, summaries, sources and cancellation.

Typed requests use the selected worker. Local text mode opens no voice connection
and requests no microphone. During a voice call, Doubao reads the resulting
utterance. Missing text-model selection produces an inline configuration message
and preserves the draft, rather than storing a retryable history error.

Real-service checks found that `speech_text_buffer.commit` reads supplied text
and returns audio, without a conversational text answer. Qwen maps interactive
text to that event; this mapping was not retained. Known result TTS text is
recorded locally, then confirmed only after audio-end and actual playback drain.

The browser currently has saved Doubao configuration, but no selected slow model.
No credentials were replaced or written to this report. Actual background model
availability, natural tool selection, speech latency, interruption quality and
microphone round trips remain under AIRI-004. No new provider/account was added.

## Executed checks

Commands use the Node and pnpm runtime initialized by `scripts/airi-env.ps1`.
`$env:Path` includes `airi/node_modules/.bin`. Browser tests use the existing
`.tools/playwright` installation. Logs live in the workspace `.runtime` directory.

| Check | Command or entry | Result | Log |
| --- | --- | --- | --- |
| Runtime and real local WebSocket regression | From `packages/realtime-voice`: `& $AiriNode ../../node_modules/vitest/vitest.mjs run` | Exit 0; 4 files, 21 tests | `brain-runtime.log` |
| Browser, tool rounds, playback and companion | Root Vitest browser command below | Exit 0; 4 files, 10 tests | `brain-browser.log` |
| Changed workspaces | `pnpm --filter '@proj-airi/realtime-voice' --filter '@proj-airi/stage-ui' --filter '@proj-airi/stage-layouts' --filter '@proj-airi/stage-pages' --filter '@proj-airi/stage-web' run typecheck` | Exit 0 for all five; final root check also includes these packages | `brain-types.log` |
| Root shared types | `pnpm typecheck` | Exit 0; 55 successful tasks, with Turbo cache | `brain-root-types.log` |
| Repository lint | `pnpm lint` | Exit 0; 0 errors, 603 warnings | `brain-lint.log` |
| Modified source lint | Targeted `pnpm exec eslint ... --fix` | Exit 0 | `brain-eslint.log`, `brain-eslint-final.log` |
| Locale build | `pnpm --filter '@proj-airi/i18n' build` | Exit 0 | `brain-i18n.log` |
| Gateway build | `pnpm --filter '@proj-airi/realtime-voice' build` | Exit 0 | `brain-build-voice.log` |
| Web production build | `pnpm --filter '@proj-airi/stage-web' build` | Exit 0; YAML sourcemap/plugin timing warnings | `brain-build-web.log` |

```powershell
& $AiriNode $AiriPnpm exec vitest run --config packages/stage-ui/vitest.config.ts --project browser src/stores/modules/realtime-brain.browser.test.ts src/stores/modules/realtime-audio.browser.test.ts src/stores/chat/voice-transcript.browser.test.ts src/stores/companion.browser.test.ts
```

The runtime tests cover nonblocking acceptance, continued conversation, revision,
cancellation, duplicate calls, timeout, bounded context, lifecycle disposal and
matched tool batches. Browser tests execute real Pinia, core-agent streaming and
database tool rounds with simulated service boundaries. They cover typed request
delivery, real DOM revision controls, no microphone/voice connection in text mode,
idle gating, playback drain, interrupted output and late-event rejection. The
audio suite uses a real AudioWorklet; the companion regression remains passing.

Initial regression reproduced the old missing text route. Live testing then
exposed the incorrect assumption that greeting TTS was a user-text query. Tests
were changed to assert the actual worker route and local known-TTS transcript;
they do not claim simulated provider output proves live model quality.

Sandbox runs could not spawn Vite/TypeScript child processes (`EPERM`); approved
local subprocess runs completed. One targeted native lint process crashed without
a diagnostic; the same changed files passed on retry. One full lint run also
crashed at shutdown after reporting zero errors; a serial retry exited 0, with
the crash log preserved as `brain-lint-crash.log`. Browser fixtures retain
Vite future-config warnings and companion route warnings. They did not fail tests.

## Real service and UI observations

- The actual 5173 listener was traced to the project's existing managed launcher.
  It was restarted with existing scripts after rebuilding the gateway; HTTP 200
  and the new settings/stage controls were verified.
- A short synthetic text query entered the initial voice route. Authentication
  reached `session.created`, but no text answer appeared. Bounded probes with
  minimal synthetic context received greeting audio and `response.done`, without
  `response.output_text`. User-only history injection, with or without force
  commit, did not produce a text answer within the probe timeout. This is evidence
  for the tested paths, not proof that every future API version lacks text input.
- The final browser UI preserves the unauthenticated Chinese name 陌生人, shows
  that the slow model is missing, disables text-session start until selection,
  and provides a configuration link. Missing-model text input shows the localized
  explanation and preserves the draft. Historical errors were not deleted.
- The browser has no camera device. No microphone permission or real voice
  round-trip test was performed. The actual slow model is unconfigured; only the
  service boundary was simulated for worker tests.

## Manual follow-up

Select an existing usable provider and model in Consciousness. Test a plain-text
answer and a record lookup, then a voice delegation. Verify A-to-B revision,
casual chat during work, explicit cancellation, user interruption, failed tools,
clarification requests, and result delivery after playback. Observe actual
latency and sound quality with a microphone. Do not infer those from these tests.

Wiki manual review, final `project-wiki.mjs check`, index generation and task
validation are recorded under AIRI-016. See
[the usage guide](../../../../开发文档/06-realtime-voice.md).
