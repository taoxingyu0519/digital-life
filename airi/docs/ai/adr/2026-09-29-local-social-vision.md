# Local social vision has one camera owner

Status: Implemented for local Windows Web. Full quality and performance acceptance remains open.

The active-mode ADR dated 2026-09-30 supersedes default-off capture, mandatory enrollment, calibration gating, and realtime suppression below.

## Context

The supplied v2 archive contains a specification, contracts, and a test matrix. It contains no working service.
The existing fork has guest entry and a separate realtime voice gateway.
The original visual workload runs through configured providers and a periodic vision pipeline.

## Decision

- Keep continuous detection in a loopback Python service.
- Reuse the elected Web owner, provider inference, speech intent bus, and speech output controls.
- Use the supplied LV01 binary frame protocol at the Python boundary.
- Keep Eventa for existing speech events. Python does not join the plugin event bus.
- Validate control requests with Pydantic and browser results with Valibot.
- Pair the camera with an expiring, single-use WebSocket ticket.
- Keep the service credential in a private file. The same-origin gateway reads it.
- Share a Web Lock between local perception and the MediaPipe workshop.
- Keep permission choices, images, identities, and observation state outside synchronized Pinia.
- Project fresh visual text immediately before the provider request, after prompt diagnostics.
- Mark derived replies and exclude them from subsequent provider history and cloud message sync.
- Display proactive greetings outside chat history. Use existing speech intents for optional playback.
- Require explicit consent before identity enrollment or cloud image transmission.
- Encrypt face templates with Windows DPAPI. Disable naming before matching calibration.

## Limits and tradeoffs

The first version suppresses proactive speech while the microphone or realtime call is active.
It handles at most three person tracks and analyzes face and hand motion only with one visible person.
Overlapping people lose identity confirmation. Ambiguous ownership never produces a named gesture.

Names require independent calibration clips. A changed gallery, model, or camera invalidates calibration.
No identity grants authentication or account access.
Grounding DINO has a separate, explicit dependency and model preparation command.
The existing realtime voice provider does not receive visual context in this version.

The Web gateway supports loopback development and preview only.
Desktop, mobile, LAN cameras, real API quality, and eight-hour stability require separate validation.

## Evidence

See `services/local-vision/reports/` and workspace `开发文档/07-local-vision.md`.
Test reports distinguish synthetic execution, automated behavior, and unrun human-data acceptance.
