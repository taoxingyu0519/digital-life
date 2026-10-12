import { PcmFramer } from './pcm'

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  private readonly framer = new PcmFramer(sampleRate)

  process(inputs: Float32Array[][]) {
    const input = inputs[0]?.[0]
    if (input)
      this.framer.push(input, frame => this.port.postMessage(frame, [frame]))
    return true
  }
}

registerProcessor('airi-realtime-capture', VoiceCaptureProcessor)
