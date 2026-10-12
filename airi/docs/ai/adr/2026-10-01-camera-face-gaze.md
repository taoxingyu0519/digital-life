# Camera face attention on the Web stage

Status: Implemented. Live laptop validation is pending under AIRI-009.

## Context

The user requests that the character's eyes and head follow people in the camera instead of the mouse.
The current local service already detects faces and tracks bodies. Recognition runs less often after identity confirmation.

## Decision

- Add a nullable face box to the current observation contract. Coordinates refer to the unmirrored camera frame.
- Derive the location during existing face checks. Identity and enrollment quality do not gate attention.
- Select an explicit primary face, then retain the current track, then choose the largest visible face.
- Mirror horizontal coordinates and apply time-based smoothing with a small dead zone.
- Hold detector misses for 250 ms. Reject evidence older than 500 ms, including measured transport latency.
- Release attention on passive mode, lost ownership, permission revocation, and source generation changes.
- Pass normalized gaze through Stage. Each renderer uses its actual canvas bounds.
- Keep camera gaze outside Live2D's pointer inactivity timer. Use the existing universal motion driver.
- Add bounded VRM head attention after animation and before humanoid update. Restore the previous base pose before each mixer step.
- Keep gaze local. Add no camera owner, model, identity record, cloud request, or synchronized gaze state.

## Limits

Manual motion control retains priority. Magic, MMD, Spine and static renderers do not receive new face head control.
Generated camera streams test the browser path with an inference fixture. They do not establish laptop latency or physical direction.
See `services/local-vision/reports/validation.face-gaze.md` for executed checks.
