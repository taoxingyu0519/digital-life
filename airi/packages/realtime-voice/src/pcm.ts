/** Averages source samples into 16 kHz PCM16 frames without discarding fractional sample boundaries. */
export class PcmFramer {
  private remaining: number
  private sum = 0
  private frame = new ArrayBuffer(640)
  private view = new DataView(this.frame)
  private offset = 0
  private readonly ratio: number

  constructor(rate: number) {
    if (!Number.isFinite(rate) || rate < 16000)
      throw new Error('Capture rate must be at least 16 kHz')
    this.ratio = rate / 16000
    this.remaining = this.ratio
  }

  push(samples: Float32Array, emit: (frame: ArrayBuffer) => void) {
    for (const sample of samples) {
      let available = 1
      while (available > 1e-9) {
        const weight = Math.min(available, this.remaining)
        this.sum += (Number.isFinite(sample) ? sample : 0) * weight
        this.remaining -= weight
        available -= weight
        if (this.remaining < 1e-9) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio))
          this.view.setInt16(this.offset, Math.round(value * (value < 0 ? 32768 : 32767)), true)
          this.offset += 2
          this.sum = 0
          this.remaining = this.ratio
          if (this.offset === 640) {
            emit(this.frame)
            this.frame = new ArrayBuffer(640)
            this.view = new DataView(this.frame)
            this.offset = 0
          }
        }
      }
    }
  }
}

/** Decodes the negotiated mono PCM16 little-endian output. Float32 output is not accepted. */
export function decodePcm16(bytes: Uint8Array) {
  if (!bytes.byteLength || bytes.byteLength % 2)
    throw new Error('Invalid PCM16 frame')
  const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const samples = new Float32Array(bytes.byteLength / 2)
  for (let index = 0; index < samples.length; index++)
    samples[index] = input.getInt16(index * 2, true) / 32768
  return samples
}
