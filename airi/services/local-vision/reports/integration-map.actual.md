# Actual integration map

Baseline: `main@2e0e963670e5435a2909149fff1f83b93f8ffd11`.
Remote: `https://github.com/moeru-ai/airi.git`.
Primary deployment: Windows Web at `http://127.0.0.1:5173`.
The starting worktree already contained guest mode, realtime voice, and integration removals.
`baseline-changes.txt` records those changes. They remain in place.

| Responsibility | Actual entry |
| --- | --- |
| Application owner | `apps/stage-web/src/App.vue`, `components/local-vision-runtime.vue` |
| Settings | `packages/stage-pages/src/pages/settings/modules/vision.vue` |
| UI and ephemeral state | `packages/stage-ui/src/components/scenarios/local-vision-panel.vue`, `stores/local-vision.ts` |
| Camera and protocol | `packages/local-vision/src/client.ts`, `contracts.ts`, `camera-lease.ts` |
| Same-origin gateway | `packages/local-vision/src/vite.ts`, `apps/stage-web/vite.config.ts` |
| Models and identity | `services/local-vision/model.py`, `identity.py`, `temporal.py` |
| Current request projection | `packages/stage-ui/src/services/local-vision-context.ts`, `stores/chat.ts` |
| Speech intent | `stores/speech-runtime.ts`, `stores/speech-output-control.ts` |
| Visual provider | `composables/vision/use-vision-inference.ts` |
| Derived history protection | `packages/core-agent/src/types/chat.ts`, `libs/chat-sync/wire-message.ts`, `stores/modules/realtime-voice.ts` |
| Reproducible commands | workspace `scripts/vision.ps1` |

## Adaptation decisions

The supplied package is a specification. It contains no existing implementation to import.
The service follows its binary frame envelope but uses a separate HTTP control boundary.
Existing Eventa speech intents remain the output path.
The Python worker does not connect to AIRI's plugin server.

The initial integration supports local Windows Web only.
MediaPipe analyzes one unambiguous person. The tracker reports at most three people.
Microphone activation suppresses greetings conservatively, without depending on a page-owned VAD.
Recovery requires an explicit restart action after a failed connection.
Grounding DINO is implemented behind explicit preparation and remains unconfigured in this delivery.

These choices differ from the full specification's broader acceptance targets.
The acceptance report retains missing evidence. No full acceptance is claimed.
