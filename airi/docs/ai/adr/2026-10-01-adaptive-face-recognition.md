# Adaptive local face recognition

Status: Implemented for this non-commercial scientific research workspace.

## Context

The user requests stable continuous identity with lower compute cost and approves the researched approach.
The user specifies non-commercial, non-profit scientific research. Each artifact retains its upstream license.
Existing names, encrypted photos and conversational memories must survive model changes.

## Decision

- Keep the camera and ByteTrack active. Continue cheap face visibility and quality checks at up to five per second.
- Reduce embeddings to about one per second after confirmation while the face thumbnail stays stable.
- Restore frequent embeddings for new tracks, appearance changes and enrollment. Multiple faces revoke identity immediately.
- Fuse bounded, quality-weighted scores only when the current frame independently supports one unique person.
- Clear retained images and evidence after loss, overlap, revocation and capture reset.
- Use EdgeFace S on this machine after a local comparison with SFace and EdgeFace XS.
- Use the existing CPU ONNX Runtime with bounded threads. Add no PyTorch inference dependency or cloud recognition service.
- Preserve SFace enrollment templates. Store encrypted EdgeFace features in a separate index keyed by person, model hash and pose.
- Derive indexes from saved aligned crops locally. Refresh changed photos and names, and delete all indexes when a person is deleted.
- Download only fixed artifacts during explicit preparation. Verify weight and license hashes at startup.
- Expose extraction and skip counts through existing local metrics. Do not expose photos, vectors, names or credentials in reports.

## Evidence and limits

On this machine, median extraction time was 6.29 ms for SFace, 2.22 ms for EdgeFace XS, and 3.26 ms for EdgeFace S.
EdgeFace S had a higher minimum cross-pose similarity on the three available crops. This small sample does not establish general accuracy.
The repeat-crop probe confirmed the same profile on two fresh encounters and revoked the name after prolonged face loss.
The probe supplies body detection and timestamps. It is not live-camera evidence.
The public examples establish only a basic same-person and different-person check. They do not measure false acceptance rates.
Reduced embedding calls do not imply the same reduction in system power. YOLOX and MediaPipe still perform their own work.
This implementation uses bounded evidence weighting. It does not integrate the full CAFace network.
FaceLiVTv2 and tracker replacement remain further comparison candidates.

Sources: [EdgeFace](https://github.com/otroshi/edgeface), [ONNX export](https://github.com/yakhyo/edgeface-onnx), [CAFace](https://github.com/mk-minchul/caface).
Reports: `services/local-vision/reports/recognition-benchmark.actual.json` and `recognition-probe.actual.json`.
