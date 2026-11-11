import type { FrameResult, VisionSource } from './contracts'

import { parse } from 'valibot'

import { CameraLease } from './camera-lease'
import { frameResultSchema, sameSource, sourceSchema } from './contracts'

export async function visionRequest(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<unknown> {
  const response = await fetch(`/api/local-vision${path}`, {
    method,
    headers: { 'X-Airi-Vision': '1', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(path.endsWith('/find') ? 21000 : 6000),
  })
  if (!response.ok)
    throw new Error(`local-vision:${response.status}`)
  return response.json()
}

/** Sends at most one frame per second with one frame in flight. stop fences every pending callback. */
export class LocalVisionCapture {
  source?: VisionSource
  stream?: MediaStream
  video?: HTMLVideoElement
  private socket?: WebSocket
  private stopped = false
  private seq = 0
  private inFlight = false
  private sentAt = 0
  private timer?: ReturnType<typeof setTimeout>
  private canvas = document.createElement('canvas')
  private recent: { at: number, blob: Blob }[] = []
  private retainImages = false
  private lease = new CameraLease()

  constructor(private readonly receive: (result: FrameResult, roundTripMs: number) => void, private readonly failed: () => void) {}

  async start(owner: string, deviceId?: string, face = false) {
    await this.lease.acquire()
    if (this.stopped)
      return this.stop()
    this.source = parse(sourceSchema, await visionRequest('/bindings', { owner }))
    if (this.stopped)
      return this.stop()
    const media = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) }, audio: false })
    this.stream = media
    if (this.stopped)
      return this.stop()
    media.getVideoTracks()[0].addEventListener('ended', () => this.fail(), { once: true })
    this.video = document.createElement('video')
    this.video.muted = true
    this.video.playsInline = true
    this.video.srcObject = media
    await this.video.play()
    await this.setFacePolicy(face)
    if (this.stopped || !this.source)
      return this.stop()
    const ticket = await visionRequest(`/bindings/${this.source.session_binding_id}/ticket`, undefined, 'POST')
    if (this.stopped)
      return this.stop()
    if (!ticket || typeof ticket !== 'object' || !('ticket' in ticket) || typeof ticket.ticket !== 'string')
      throw new Error('Invalid camera ticket')
    const streamUrl = new URL('/api/local-vision/stream', window.location.href)
    streamUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    streamUrl.searchParams.set('ticket', ticket.ticket)
    const socket = new WebSocket(streamUrl)
    this.socket = socket
    socket.onmessage = (event) => {
      if (this.stopped || !this.source)
        return
      try {
        const result = parse(frameResultSchema, JSON.parse(event.data))
        if (!sameSource(result.snapshot, this.source) || result.snapshot.seq !== this.seq - 1)
          return
        this.inFlight = false
        const elapsed = performance.now() - this.sentAt
        if (elapsed <= 2000)
          this.receive(result, elapsed)
      }
      catch { this.fail() }
    }
    socket.onclose = () => this.fail()
    socket.onerror = () => this.fail()
    socket.onopen = () => {
      clearTimeout(this.timer)
      void this.tick()
    }
    this.timer = setTimeout(() => this.fail(), 5000)
  }

  async setFacePolicy(face: boolean) {
    if (!this.source)
      return
    const settings = this.stream?.getVideoTracks()[0].getSettings()
    const camera = new TextEncoder().encode(JSON.stringify([settings?.deviceId, this.video?.videoWidth, this.video?.videoHeight]))
    const digest = await crypto.subtle.digest('SHA-256', camera)
    const cameraCondition = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    const source = parse(sourceSchema, await visionRequest(`/bindings/${this.source.session_binding_id}/policy`, { face, camera_condition: cameraCondition }))
    if (!this.stopped) {
      this.source = source
      this.inFlight = false
    }
  }

  setImagePermission(allowed: boolean) {
    this.retainImages = allowed
    this.recent = []
  }

  async snapshots(recent = false): Promise<Blob[]> {
    const current = await this.snapshot()
    if (!recent)
      return [current]
    const cutoff = performance.now() - 3000
    return [...this.recent.filter(frame => frame.at > cutoff).map(frame => frame.blob).slice(-5), current]
  }

  private fail() {
    if (this.stopped)
      return
    this.stop()
    this.failed()
  }

  async snapshot(): Promise<Blob> {
    const video = this.video
    if (this.stopped || !video?.videoWidth)
      throw new Error('No current camera frame')
    const scale = Math.min(1, 1280 / video.videoWidth, 720 / video.videoHeight)
    this.canvas.width = Math.round(video.videoWidth * scale)
    this.canvas.height = Math.round(video.videoHeight * scale)
    this.canvas.getContext('2d')!.drawImage(video, 0, 0, this.canvas.width, this.canvas.height)
    return new Promise((resolve, reject) => this.canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Camera encoding failed')), 'image/jpeg', 0.8))
  }

  private async tick() {
    if (this.stopped)
      return
    try {
      if (this.inFlight && performance.now() - this.sentAt > 5000)
        return this.fail()
      if (!this.inFlight && this.source && this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount < 1048576) {
        this.inFlight = true
        const source = this.source
        const jpeg = await this.snapshot()
        if (this.stopped || source !== this.source) {
          this.inFlight = false
          return
        }
        const now = performance.now()
        if (this.retainImages && now - (this.recent.at(-1)?.at ?? -Infinity) >= 500) {
          this.recent = [...this.recent.filter(frame => now - frame.at < 3000), { at: now, blob: jpeg }].slice(-5)
        }
        const header = new TextEncoder().encode(JSON.stringify({
          ...source,
          schema_version: '1.0',
          seq: this.seq++,
          captured_at_utc: new Date().toISOString(),
          capture_monotonic_ms: performance.now(),
          width: this.canvas.width,
          height: this.canvas.height,
          mime_type: 'image/jpeg',
          jpeg_bytes: jpeg.size,
        }))
        const prefix = new Uint8Array(8)
        prefix.set(new TextEncoder().encode('LV01'))
        new DataView(prefix.buffer).setUint32(4, header.length)
        this.sentAt = performance.now()
        this.socket.send(new Blob([prefix, header, jpeg]))
      }
    }
    catch { return this.fail() }
    finally {
      if (!this.stopped)
        this.timer = setTimeout(() => { void this.tick() }, 1000)
    }
  }

  stop() {
    this.stopped = true
    this.lease.stop()
    clearTimeout(this.timer)
    this.socket?.close()
    this.stream?.getTracks().forEach(track => track.stop())
    if (this.video)
      this.video.srcObject = null
    this.canvas.width = 0
    this.canvas.height = 0
    this.recent = []
    if (this.source)
      void visionRequest(`/bindings/${this.source.session_binding_id}`, undefined, 'DELETE').catch(() => {})
    this.source = undefined
  }
}
