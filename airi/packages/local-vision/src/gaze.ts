import type { FrameResult, VisionSource } from './contracts'

import { sameSource } from './contracts'

/**
 * Owns one ephemeral face target per camera generation. Unknown faces can receive attention.
 * Call on each render tick. Permission loss clears state immediately. Brief detector misses hold for 250 ms.
 * Output uses mirrored, normalized stage coordinates. No image, identity or history is retained.
 */
export class FaceGaze {
  private source?: VisionSource
  private track?: string
  private missed = 0
  private position?: { x: number, y: number }

  update(frame: FrameResult | undefined, source: VisionSource | undefined, ageMs: number, allowed: boolean, deltaSeconds: number) {
    if (!allowed || !source || !frame || !sameSource(frame.snapshot, source) || ageMs > 500 || ageMs < 0) {
      this.clear()
      return undefined
    }
    if (this.source && !sameSource(this.source, source))
      this.clear()
    // Keep our own generation snapshot even if the capture client updates its source object in place.
    this.source = {
      session_binding_id: source.session_binding_id,
      source_id: source.source_id,
      epoch: source.epoch,
      privacy_generation: source.privacy_generation,
    }

    const faces = frame.snapshot.payload.actors.filter(actor => actor.face_bbox !== null)
    let actor = faces.find(actor => actor.primary)
      ?? faces.find(actor => actor.track_id === this.track)
    if (!actor) {
      actor = faces.reduce<(typeof faces)[number] | undefined>((largest, candidate) => {
        const box = candidate.face_bbox!
        const previous = largest?.face_bbox
        return !previous || (box[2] - box[0]) * (box[3] - box[1]) > (previous[2] - previous[0]) * (previous[3] - previous[1])
          ? candidate
          : largest
      }, undefined)
    }
    const delta = Math.max(0, Math.min(0.1, deltaSeconds))
    if (!actor?.face_bbox) {
      this.missed += delta
      if (this.missed >= 0.25)
        this.clear()
      return this.position
    }
    this.missed = 0
    this.track = actor.track_id
    const box = actor.face_bbox
    // Self-view is mirrored. A person moving left on their screen receives a matching leftward gaze.
    const target = { x: 1 - (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 }
    this.position ??= { x: 0.5, y: 0.5 }
    const alpha = 1 - Math.exp(-delta / 0.12)
    if (Math.abs(target.x - this.position.x) > 0.008)
      this.position.x += (target.x - this.position.x) * alpha
    if (Math.abs(target.y - this.position.y) > 0.008)
      this.position.y += (target.y - this.position.y) * alpha
    return { ...this.position }
  }

  private clear() {
    this.source = undefined
    this.track = undefined
    this.position = undefined
    this.missed = 0
  }
}
