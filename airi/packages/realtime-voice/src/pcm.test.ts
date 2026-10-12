import { describe, expect, it } from 'vitest'

import { decodePcm16, PcmFramer } from './pcm'

describe('voice PCM boundaries', () => {
  it.each([16000, 24000, 44100, 48000])('captures one second at %i Hz as fifty 20 ms frames', (rate) => {
    const framer = new PcmFramer(rate)
    const frames: ArrayBuffer[] = []
    const samples = new Float32Array(rate).fill(0.5)
    for (let offset = 0; offset < samples.length; offset += 128)
      framer.push(samples.subarray(offset, offset + 128), frame => frames.push(frame))
    expect(frames).toHaveLength(50)
    for (const frame of frames) {
      expect(frame.byteLength).toBe(640)
      expect(new DataView(frame).getInt16(0, true)).toBe(16384)
    }
  })

  it('clips input and explicitly decodes little-endian signed output', () => {
    const samples = decodePcm16(new Uint8Array([0, 128, 255, 127, 0, 0]))
    expect([...samples]).toEqual([-1, 32767 / 32768, 0])
    expect(() => decodePcm16(new Uint8Array([1]))).toThrow('Invalid PCM16')
    const frames: ArrayBuffer[] = []
    new PcmFramer(16000).push(new Float32Array(320).fill(-4), frame => frames.push(frame))
    expect(new DataView(frames[0]).getInt16(0, true)).toBe(-32768)
  })
})
