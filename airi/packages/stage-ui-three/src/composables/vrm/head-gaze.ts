import type { Object3D } from 'three'

import { Euler, Quaternion } from 'three'

/**
 * Layers bounded camera attention onto the current animation pose.
 * Restore before the mixer, then apply before humanoid.update. This prevents cumulative head rotation.
 */
export class HeadGaze {
  private head?: Object3D
  private base = new Quaternion()
  private offset = new Quaternion()
  private angles = new Euler(0, 0, 0, 'YXZ')
  private pitch = 0
  private yaw = 0

  restore() {
    this.head?.quaternion.copy(this.base)
  }

  apply(head: Object3D | null | undefined, target: { x: number, y: number } | undefined, delta: number) {
    if (this.head !== head) {
      this.restore()
      this.pitch = 0
      this.yaw = 0
      this.head = head ?? undefined
    }
    if (!head)
      return
    const alpha = 1 - Math.exp(-Math.max(0, Math.min(0.1, delta)) / 0.18)
    // VRM's normalized forward is -Z. Screen-right yaw is positive, and downward pitch is negative.
    const pitch = target ? (0.5 - Math.max(0, Math.min(1, target.y))) * 0.4 : 0
    const yaw = target ? (Math.max(0, Math.min(1, target.x)) - 0.5) * 0.6 : 0
    this.pitch += (pitch - this.pitch) * alpha
    this.yaw += (yaw - this.yaw) * alpha
    this.base.copy(head.quaternion)
    this.offset.setFromEuler(this.angles.set(this.pitch, this.yaw, 0, 'YXZ'))
    head.quaternion.multiply(this.offset)
  }
}
