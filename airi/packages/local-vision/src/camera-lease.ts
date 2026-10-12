/** Shares camera ownership between local perception and the MediaPipe workshop. */
export class CameraLease {
  private release?: () => void
  private stopped = false

  acquire(): Promise<void> {
    return new Promise((resolve, reject) => {
      void navigator.locks.request('airi:camera', { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(new Error('Camera is already owned by another AIRI window'))
          return
        }
        const held = new Promise<void>((done) => {
          this.release = done
        })
        if (this.stopped)
          this.release?.()
        resolve()
        await held
      }).catch(reject)
    })
  }

  stop() {
    this.stopped = true
    this.release?.()
  }
}
