import captureUrl from '@proj-airi/realtime-voice/capture.worklet?worker&url'

import { RealtimeAudio } from '@proj-airi/realtime-voice/audio'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

const contexts: AudioContext[] = []
const runtimes: RealtimeAudio[] = []

afterEach(async () => {
  runtimes.splice(0).forEach(runtime => runtime.close())
  await Promise.all(contexts.splice(0).map(context => context.close()))
  vi.restoreAllMocks()
})

function fixture() {
  const context = new AudioContext({ sampleRate: 48000 })
  contexts.push(context)
  const microphone = context.createMediaStreamDestination()
  const speaking = vi.fn()
  const runtime = new RealtimeAudio(context, captureUrl, speaking)
  runtimes.push(runtime)
  return { context, microphone, speaking, runtime }
}

async function unlockAudio(context: AudioContext) {
  const button = document.createElement('button')
  button.textContent = 'Start voice test'
  let resumed: Promise<void> | undefined
  button.onclick = () => {
    resumed = context.resume()
  }
  document.body.append(button)
  await userEvent.click(button)
  await resumed
  button.remove()
}

describe('realtime browser audio lifecycle', () => {
  // http://127.0.0.1:5174 — AIRI-022: a normal answer arriving faster than playback ended the call.
  // ROOT CAUSE: the ten-second scheduled-audio limit treated a normal TTS burst as a fatal queue error.
  it('aIRI-022 buffers a normal speech burst over ten seconds without ending playback', async () => {
    const { context, runtime, speaking } = fixture()
    await unlockAudio(context)
    const pcm = btoa('\0'.repeat(144000))
    expect(() => {
      for (let index = 0; index < 5; index++)
        runtime.play(pcm)
    }).not.toThrow()
    expect(speaking).toHaveBeenCalledWith(true, expect.any(AudioBufferSourceNode))
    runtime.interrupt()
    expect(speaking).toHaveBeenLastCalledWith(false)
  })

  it('drains buffered audio before releasing speech and preserves real overflow and format failures', async () => {
    const { context, runtime, speaking } = fixture()
    await unlockAudio(context)
    const pcm = btoa('\0'.repeat(48000))
    for (let index = 0; index < 3; index++)
      runtime.play(pcm)
    await vi.waitFor(() => expect(speaking).toHaveBeenLastCalledWith(false), { timeout: 4500 })
    expect(speaking.mock.calls.filter(call => call[0])).toHaveLength(3)
    expect(() => runtime.play(btoa('\0'))).toThrow('audio-format')
    expect(() => {
      for (let index = 0; index < 181; index++)
        runtime.play(pcm)
    }).toThrow('audio-queue')
    runtime.interrupt()
  })

  it('captures 20 ms frames in a real worklet and stops the microphone on hangup', async () => {
    const { context, microphone, runtime } = fixture()
    await unlockAudio(context)
    const oscillator = context.createOscillator()
    oscillator.connect(microphone)
    oscillator.start()
    const permission = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(microphone.stream)
    const frame = vi.fn()
    await runtime.start(frame, 'selected-device')
    await vi.waitFor(() => expect(frame.mock.calls.length).toBeGreaterThan(1))
    expect(permission).toHaveBeenCalledWith({ audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      deviceId: { exact: 'selected-device' },
    } })
    expect(atob(frame.mock.calls[0][0])).toHaveLength(640)
    runtime.close()
    expect(microphone.stream.getAudioTracks()[0].readyState).toBe('ended')
    expect(context.state).toBe('running')
    oscillator.stop()
  })

  it('releases a microphone permission result that arrives after the user hangs up', async () => {
    const { context, microphone, runtime } = fixture()
    await unlockAudio(context)
    let grant!: (stream: MediaStream) => void
    const permission = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(() => new Promise((resolve) => {
      grant = resolve
    }))
    const frame = vi.fn()
    const starting = runtime.start(frame)
    await vi.waitFor(() => expect(permission).toHaveBeenCalledOnce())
    runtime.close()
    grant(microphone.stream)
    await starting
    expect(microphone.stream.getAudioTracks()[0].readyState).toBe('ended')
    expect(frame).not.toHaveBeenCalled()
  })

  it('plays explicit PCM16 at 24 kHz and cancels queued speech on interrupt or mute', async () => {
    const { context, runtime, speaking } = fixture()
    await unlockAudio(context)
    const pcm = btoa(String.fromCharCode(...new Uint8Array(4800)))
    runtime.play(pcm)
    const source: AudioBufferSourceNode = speaking.mock.calls.at(-1)![1]
    expect(source.buffer?.sampleRate).toBe(24000)
    expect(source.buffer?.duration).toBe(0.1)
    runtime.interrupt()
    expect(speaking).toHaveBeenLastCalledWith(false)
    runtime.play(pcm)
    runtime.setMuted(true)
    expect(runtime.output.gain.value).toBe(0)
    expect(speaking).toHaveBeenLastCalledWith(false)
    runtime.close()
    runtime.play(pcm)
    expect(speaking).toHaveBeenLastCalledWith(false)
  })
})
