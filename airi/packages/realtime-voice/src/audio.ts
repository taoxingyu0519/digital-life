import { decodePcm16 } from './pcm'

const loadedWorklets = new WeakMap<AudioContext, Promise<void>>()

/** Owns microphone capture and queued playback. The shared AIRI AudioContext stays open after calls. */
export class RealtimeAudio {
  readonly output: GainNode
  private stream?: MediaStream
  private input?: MediaStreamAudioSourceNode
  private capture?: AudioWorkletNode
  private silence?: GainNode
  private closed = false
  private readonly sources = new Set<AudioBufferSourceNode>()
  private nextTime = 0
  private readonly pending: ReturnType<typeof decodePcm16>[] = []
  private pendingSamples = 0

  constructor(
    private readonly context: AudioContext,
    private readonly workletUrl: string,
    private readonly onSpeaking: (speaking: boolean, source?: AudioBufferSourceNode) => void,
  ) {
    this.output = context.createGain()
    this.output.connect(context.destination)
  }

  async start(onFrame: (audio: string) => void, deviceId?: string) {
    await this.context.resume()
    if (this.closed)
      return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    } })
    if (this.closed) {
      stream.getTracks().forEach(track => track.stop())
      return
    }
    this.stream = stream
    let loaded = loadedWorklets.get(this.context)
    if (!loaded) {
      loaded = this.context.audioWorklet.addModule(this.workletUrl)
      loadedWorklets.set(this.context, loaded)
      void loaded.catch(() => loadedWorklets.delete(this.context))
    }
    await loaded
    if (this.closed)
      return
    this.input = this.context.createMediaStreamSource(stream)
    this.capture = new AudioWorkletNode(this.context, 'airi-realtime-capture')
    this.silence = this.context.createGain()
    this.silence.gain.value = 0
    this.capture.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
      if (!this.closed && data.byteLength === 640)
        onFrame(btoa(String.fromCharCode(...new Uint8Array(data))))
    }
    this.input.connect(this.capture)
    this.capture.connect(this.silence)
    this.silence.connect(this.context.destination)
  }

  play(base64: string) {
    if (this.closed)
      return
    let samples: ReturnType<typeof decodePcm16>
    try {
      samples = decodePcm16(Uint8Array.from(atob(base64), c => c.charCodeAt(0)))
    }
    catch { throw new Error('audio-format') }
    // TTS can arrive faster than playback. Keep a bounded backlog and schedule only a short window.
    const duration = Math.max(0, this.nextTime - this.context.currentTime) + (this.pendingSamples + samples.length) / 24000
    if (duration > 180 || this.pending.length >= 8192)
      throw new Error('audio-queue')
    this.pending.push(samples)
    this.pendingSamples += samples.length
    this.schedule()
  }

  private schedule() {
    while (this.pending.length && this.nextTime - this.context.currentTime < 2) {
      const samples = this.pending.shift()!
      this.pendingSamples -= samples.length
      this.scheduleFrame(samples)
    }
  }

  private scheduleFrame(samples: ReturnType<typeof decodePcm16>) {
    const buffer = this.context.createBuffer(1, samples.length, 24000)
    buffer.copyToChannel(samples, 0)
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.output)
    this.sources.add(source)
    source.onended = () => {
      this.sources.delete(source)
      source.disconnect()
      this.schedule()
      if (!this.sources.size && !this.pending.length)
        this.onSpeaking(false)
    }
    this.nextTime = Math.max(this.nextTime, this.context.currentTime + 0.015)
    source.start(this.nextTime)
    this.nextTime += buffer.duration
    this.onSpeaking(true, source)
  }

  interrupt() {
    for (const source of this.sources) {
      source.onended = null
      source.stop()
      source.disconnect()
    }
    this.sources.clear()
    this.pending.length = 0
    this.pendingSamples = 0
    this.nextTime = 0
    this.onSpeaking(false)
  }

  setMuted(muted: boolean) {
    this.output.gain.value = muted ? 0 : 1
    if (muted)
      this.interrupt()
  }

  close() {
    if (this.closed)
      return
    this.closed = true
    this.interrupt()
    this.stream?.getTracks().forEach(track => track.stop())
    this.input?.disconnect()
    if (this.capture) {
      this.capture.port.onmessage = null
      this.capture.port.close()
      this.capture.disconnect()
    }
    this.silence?.disconnect()
    this.output.disconnect()
  }
}
