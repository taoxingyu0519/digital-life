# Active perception and conversational identity learning

Status: Implemented for local Windows Web. Human-camera and live-provider quality acceptance remain open.

## Context

The user requests continuous sight, spontaneous conversation, and natural introductions.
The supplied archive contains a specification. Its default-off and manual-enrollment policy conflicts with this newer request.
This decision supersedes those parts of the 2026-09-29 local social vision ADR.

## Decision

- Default to active mode. Persist the local mode and provide a stage toggle.
- Capture locally through the existing elected owner and Web Lock. Passive mode releases capture and cancels pending thoughts.
- Keep continuous recognition local. Send no cloud camera frames without the separate image permission and manual action.
- Learn names only from real finalized input paired with one fresh, quality-checked face.
- Create a local profile after ten consistent samples. Save one encrypted crop and template per new face angle.
- Keep Windows DPAPI for face templates, crops and memory text. Store names and encounter times in local SQLite.
- Scope quoted user statements by person and character. Deduplicate turn IDs and cap memories at eighty statements per pair.
- Reject multi-person, stale, ambiguous and revoked evidence before worker mutations. Do not treat tracks as persistent identity.
- Use strict social similarity limits and spaced confirmations. Manual calibration becomes an optional quality evaluation.
- Reuse the configured chat model for bounded proactive thoughts. Use local templates when no model is configured.
- Give actual user speech, ASR and assistant responses priority. An idle microphone or call does not block greeting.
- Reuse speech intents, mute, stop and the existing realtime gateway.
- Start at most one configured realtime call per encounter. End automatic calls after thirty seconds without a visible person.
- Do not reconnect automatically after manual hangup or the existing ten-minute call limit.
- Use official `speech_text_buffer.commit` for proactive voice and `session.update` for bounded visual context.
- Append local assistant events with `localVisionDerived`. Never invent a user message to trigger a model.
- Exclude derived replies from cloud synchronization and later provider history.

## Tradeoffs and evidence

Default camera and local learning follow the user's explicit request. Participants retain permission controls and profile deletion.
Face matching supports social personalization. It grants no account access and has no liveness defense.
Photos are face crops, not recordings. Missing angles accumulate naturally and do not block a first introduction.
Quoted memories remain untrusted data. They do not prove a fact, feeling or shared experience.
No new accounts, credentials, paid services or general-purpose libraries are added.

SFace limits reference [OpenCV's published examples](https://docs.opencv.org/4.13.0/d0/dd4/tutorial_dnn_face.html).
The stricter starting threshold here is an engineering choice. It does not establish local human-data accuracy.
Voice commands follow [Doubao's official full-duplex protocol](https://docs.volcengine.com/docs/DoubaoVoice/endtoend-realtime-voice-full-duplex-version?lang=zh).

See `services/local-vision/reports/validation.active-companion.md` and workspace `开发文档/07-local-vision.md` for actual checks and limits.

## Continuous identity repair on 2026-10-01

Perception runs independently from pending microphone requests and proactive replies.
Initialize the guest session before capture ownership. Compare scalar encounter values when cancelling pending work.
Distinguish loaded models, an open camera awaiting inference, and processed camera frames in the UI.
Send realtime context when the call becomes ready and when the profile arrives.

Append incremental ASR events. Replace cumulative hypotheses and finalized transcripts.
Reject repeated introduction markers before writing a name.
Reuse a profile only when ten new face samples strongly match one unique existing face. Names alone never combine identities.

Keep strict acquisition thresholds. Apply a separate retention threshold to a recently confirmed track.
Retain confirmed identity through at most 1.5 seconds of blur. Revoke conflicting faces, overlapping ownership and expired evidence.
Separate recognition quality from enrollment quality. Moderate frames cannot add photos or templates.
Preserve internal evidence through brief detection misses. Do not emit actors or attribute speech during those misses.

These thresholds are engineering choices. Unit and synthetic tests do not establish human-camera accuracy or energy savings.
Alternative models and adaptive inference scheduling remain evaluation candidates. Existing SFace templates keep their current model version.
