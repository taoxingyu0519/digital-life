import type { Buffer } from 'node:buffer'
import type { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

import type { VoiceConfig, VoiceConfigStatus, VoiceEvent } from './contracts'

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { WebSocket, WebSocketServer } from 'ws'

import * as v from 'valibot'

import { defaultVoiceConfig, VoiceChannel, voiceCommand, voiceConfigSchema, voiceEvent, voicePath } from './contracts'
import { DoubaoSession } from './doubao'

/** Restricts credentials and paid voice sessions to pages served by this loopback process. */
export function isLocalVoiceRequest(request: Pick<IncomingMessage, 'headers' | 'socket'>) {
  const address = request.socket.remoteAddress
  if (!address || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address))
    return false
  const host = request.headers.host
  if (!host || !/^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host))
    return false
  return request.headers.origin === `http://${host}` || request.headers.origin === `https://${host}`
}

/** Stores only the gateway credential. Reads return a configured flag, never the key. */
export class VoiceConfigFile {
  private queue = Promise.resolve()
  constructor(private readonly path: string) {}

  async read(): Promise<VoiceConfig> {
    try {
      return v.parse(voiceConfigSchema, JSON.parse(await readFile(this.path, 'utf8')))
    }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return { ...defaultVoiceConfig, apiKey: '' }
      throw new Error('Cannot read voice configuration')
    }
  }

  async status(): Promise<VoiceConfigStatus> {
    const { apiKey, ...config } = await this.read()
    return { ...config, configured: Boolean(apiKey) }
  }

  save(config: VoiceConfig) {
    const task = this.queue.then(async () => {
      const parsed = v.parse(voiceConfigSchema, config)
      const previous = await this.read()
      parsed.apiKey = parsed.apiKey.trim() || previous.apiKey
      if (!parsed.apiKey || !parsed.model.trim() || !parsed.voice.trim() || !parsed.resourceId.trim())
        throw new Error('Incomplete voice configuration')
      await mkdir(dirname(this.path), { recursive: true })
      await writeFile(`${this.path}.tmp`, `${JSON.stringify(parsed)}\n`, { mode: 0o600 })
      await rename(`${this.path}.tmp`, this.path)
    })
    this.queue = task.catch(() => {})
    return task
  }

  delete() {
    const task = this.queue.then(async () => {
      await unlink(this.path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT')
          throw error
      })
    })
    this.queue = task.catch(() => {})
    return task
  }
}

/** Attaches one local-only voice service to the app server. It permits one paid session at a time. */
export class VoiceGateway {
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 160000 })
  private owner?: WebSocket
  private activeSession?: DoubaoSession
  private readonly config: VoiceConfigFile

  constructor(private readonly server: EventEmitter, configPath: string) {
    this.config = new VoiceConfigFile(configPath)
    server.on('upgrade', this.upgrade)
    server.once('close', this.close)
  }

  private readonly upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url !== voicePath)
      return
    if (!isLocalVoiceRequest(request) || this.sockets.clients.size >= 8) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    this.sockets.handleUpgrade(request, socket, head, client => this.connect(client))
  }

  private connect(client: WebSocket) {
    const channel = new VoiceChannel('server', (data) => {
      if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 2 * 1024 * 1024)
        client.send(data)
      else
        client.close(1013, 'Voice backpressure')
    })
    const emit = (event: VoiceEvent) => {
      void channel.context.emit(voiceEvent, event)
    }
    let pending = Promise.resolve()
    let generation = 0
    const stop = () => {
      generation++
      if (this.owner === client) {
        this.activeSession?.stop()
        this.activeSession = undefined
        this.owner = undefined
      }
    }
    channel.context.on(voiceCommand, async ({ body }) => {
      if (client.readyState !== WebSocket.OPEN)
        return
      if (!body)
        throw new Error('Missing voice command')
      switch (body.type) {
        case 'config:get':
          emit({ type: 'config', id: body.id, config: await this.config.status() })
          break
        case 'config:save':
        case 'config:delete':
          if (this.owner) {
            emit({ type: 'error', code: 'busy', id: body.id })
            break
          }
          try {
            if (body.type === 'config:save')
              await this.config.save(body.config)
            else
              await this.config.delete()
            emit({ type: 'config', id: body.id, config: await this.config.status() })
          }
          catch {
            emit({ type: 'error', code: 'config', id: body.id })
          }
          break
        case 'start': {
          if (this.owner) {
            emit({ type: 'error', code: 'busy' })
            break
          }
          this.owner = client
          const epoch = ++generation
          const config = await this.config.read()
          if (epoch !== generation || client.readyState !== WebSocket.OPEN) {
            if (this.owner === client && epoch === generation)
              stop()
            break
          }
          if (!config.apiKey) {
            this.owner = undefined
            emit({ type: 'error', code: 'not-configured' })
            break
          }
          this.activeSession = new DoubaoSession(config, body.start, (event) => {
            if (generation !== epoch)
              return
            emit(event)
            if (event.type === 'stopped') {
              this.activeSession = undefined
              this.owner = undefined
            }
          })
          break
        }
        case 'audio':
          if (this.owner === client)
            this.activeSession?.appendAudio(body.audio)
          break
        case 'input-mute':
          if (this.owner === client)
            this.activeSession?.muteInput(body.muted)
          break
        case 'tool-results':
          if (this.owner === client)
            this.activeSession?.toolResults(body.results)
          break
        case 'cancel':
          if (this.owner === client)
            this.activeSession?.cancel()
          break
        case 'stop':
          stop()
          emit({ type: 'stopped' })
          break
        case 'speak':
          if (this.owner === client)
            this.activeSession?.speak(body.id, body.text)
          break
        case 'context':
          if (this.owner === client)
            this.activeSession?.context(body.instructions, body.slowBrain)
          break
      }
    })
    client.on('message', (data, binary) => {
      pending = pending.then(async () => {
        if (binary)
          throw new Error('Expected Eventa command')
        await channel.receive(data.toString())
      }).catch(() => {
        emit({ type: 'error', code: 'protocol' })
        stop()
        client.close(1008, 'Invalid voice command')
      })
    })
    client.on('error', stop)
    client.once('close', () => {
      stop()
      channel.dispose()
    })
  }

  readonly close = () => {
    this.server.off('upgrade', this.upgrade)
    this.server.off('close', this.close)
    this.activeSession?.stop()
    this.activeSession = undefined
    this.owner = undefined
    for (const client of this.sockets.clients)
      client.terminate()
    this.sockets.close()
  }
}
