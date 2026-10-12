import type { VoiceCommand, VoiceConfig, VoiceConfigStatus, VoiceEvent } from './contracts'

import { VoiceChannel, voiceCommand, voiceEvent, voicePath } from './contracts'

/** Local WebSocket client. Configuration requests time out and credentials never enter browser storage. */
export class VoiceClient {
  private readonly socket: WebSocket
  private readonly channel: VoiceChannel
  private readonly opened: Promise<void>
  private readonly pending = new Map<string, { resolve: (value: VoiceConfigStatus) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>()
  private closed = false

  constructor(onEvent: (event: VoiceEvent) => void, onDisconnect: () => void) {
    const url = new URL(voicePath, location.href)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    this.socket = new WebSocket(url)
    this.channel = new VoiceChannel('client', (data) => {
      if (this.socket.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 256 * 1024)
        throw new Error('connection')
      this.socket.send(data)
    })
    this.opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('gateway'))
        this.close()
      }, 8000)
      this.socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
      this.socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('gateway'))
      }, { once: true })
      this.socket.addEventListener('close', () => {
        clearTimeout(timer)
        reject(new Error('gateway'))
      }, { once: true })
    })
    void this.opened.catch(() => {})
    this.channel.context.on(voiceEvent, ({ body }) => {
      if (!body)
        throw new Error('Missing voice event')
      if ((body.type === 'config' || body.type === 'error') && body.id) {
        const request = this.pending.get(body.id)
        if (request) {
          clearTimeout(request.timer)
          this.pending.delete(body.id)
          if (body.type === 'config')
            request.resolve(body.config)
          else
            request.reject(new Error(body.code))
          return
        }
      }
      onEvent(body)
    })
    this.socket.addEventListener('message', (event) => {
      void this.channel.receive(String(event.data)).catch(() => {
        onEvent({ type: 'error', code: 'protocol' })
        this.close()
      })
    })
    this.socket.addEventListener('close', () => {
      this.dispose()
      onDisconnect()
    })
  }

  async send(command: VoiceCommand) {
    await this.opened
    if (this.closed)
      throw new Error('connection')
    await this.channel.context.emit(voiceCommand, command)
  }

  async config(action: 'get' | 'save' | 'delete', config?: VoiceConfig): Promise<VoiceConfigStatus> {
    await this.opened
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('timeout'))
      }, 8000)
      this.pending.set(id, { resolve, reject, timer })
      const command: VoiceCommand = action === 'save' && config
        ? { type: 'config:save', id, config }
        : { type: action === 'delete' ? 'config:delete' : 'config:get', id }
      void this.send(command).catch(() => {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error('connection'))
      })
    })
  }

  private dispose() {
    if (this.closed)
      return
    this.closed = true
    this.channel.dispose()
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('connection'))
    }
    this.pending.clear()
  }

  close() {
    this.dispose()
    this.socket.close()
  }
}
