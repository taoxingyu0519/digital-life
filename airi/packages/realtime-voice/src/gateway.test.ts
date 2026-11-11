import type { AddressInfo } from 'node:net'

import type { ClientOptions, WebSocket as WsSocket } from 'ws'

import type { VoiceCommand, VoiceEvent } from './contracts'

import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultVoiceConfig, VoiceChannel, voiceCommand, voiceEvent } from './contracts'
import { mergeTranscript } from './doubao'
import { VoiceConfigFile, VoiceGateway } from './gateway'

const provider = vi.hoisted(() => ({ url: '', requestedUrl: '' }))
vi.mock('ws', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ws')>()
  return {
    ...actual,
    WebSocket: class extends actual.WebSocket {
      constructor(url: string, options?: ClientOptions) {
        provider.requestedUrl = url
        super(provider.url, options)
      }
    },
  }
})
const actualWs = await vi.importActual<typeof import('ws')>('ws')
const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.reverse().splice(0))
    await cleanup()
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'airi-voice-test-'))
  cleanups.push(async () => {
    if (dirname(directory) !== tmpdir() || !directory.includes('airi-voice-test-'))
      throw new Error('Invalid temporary test directory')
    await rm(directory, { recursive: true, force: true })
  })
  const upstream = new actualWs.WebSocketServer({ host: '127.0.0.1', port: 0 })
  upstream.on('connection', (socket) => {
    socket.on('message', (data) => {
      if (JSON.parse(data.toString()).type === 'session.close')
        socket.send(JSON.stringify({ type: 'session.closed' }))
    })
  })
  await once(upstream, 'listening')
  provider.url = `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`
  const server = createServer()
  const path = join(directory, 'voice.json')
  const gateway = new VoiceGateway(server, path)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  cleanups.push(async () => {
    gateway.close()
    for (const socket of upstream.clients)
      socket.terminate()
    await Promise.all([
      new Promise<void>(resolve => upstream.close(() => resolve())),
      new Promise<void>(resolve => server.close(() => resolve())),
    ])
  })
  async function client() {
    const socket = new actualWs.WebSocket(`${origin.replace('http:', 'ws:')}/api/realtime-voice`, { origin })
    const channel = new VoiceChannel('client', data => socket.send(data))
    const events: VoiceEvent[] = []
    channel.context.on(voiceEvent, (event) => {
      if (event.body)
        events.push(event.body)
    })
    socket.on('message', (data) => {
      void channel.receive(data.toString())
    })
    await once(socket, 'open')
    cleanups.push(() => {
      channel.dispose()
      socket.terminate()
    })
    return { events, socket, send: (command: VoiceCommand) => channel.context.emit(voiceCommand, command) }
  }
  return { origin, client, upstream, path }
}

describe('local full-duplex voice gateway', () => {
  // http://127.0.0.1:5174 — AIRI-046: audible short replies disappeared from the stage history.
  // ROOT CAUSE: deduplication compared text across responses. New response scope now resets the text accumulator.
  it.each([true, false])('aIRI-046 preserves equal replies in separate responses, response ID=%s', async (withId) => {
    const app = await fixture()
    const client = await app.client()
    await client.send({ type: 'config:save', id: 'save', config: { ...defaultVoiceConfig, apiKey: 'test-credential' } })
    await vi.waitFor(() => expect(client.events.length).toBe(1))
    let upstreamSocket: WsSocket | undefined
    app.upstream.on('connection', (socket) => {
      upstreamSocket = socket
      socket.once('message', () => socket.send(JSON.stringify({ type: 'session.created' })))
    })
    await client.send({ type: 'start', start: { instructions: 'Generated test', history: [], slowBrain: false } })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'ready' }))
    for (const index of [1, 2]) {
      const response = withId ? { response_id: `generated-response-${index}` } : {}
      upstreamSocket?.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: `generated-input-${index}`, transcript: `Generated request ${index}` }))
      upstreamSocket?.send(JSON.stringify({ type: 'response.created', ...response }))
      upstreamSocket?.send(JSON.stringify({ type: 'response.output_text.done', ...response, text: 'Generated repeated reply' }))
      upstreamSocket?.send(JSON.stringify({ type: 'response.output_text.done', ...response, text: 'Generated repeated reply' }))
    }
    await vi.waitFor(() => expect(client.events.filter(event => event.type === 'transcript' && event.role === 'assistant' && event.final)).toHaveLength(2))
    const replies = client.events.filter((event): event is Extract<VoiceEvent, { type: 'transcript' }> => event.type === 'transcript' && event.role === 'assistant')
    expect(replies.map(event => event.text)).toEqual(['Generated repeated reply', 'Generated repeated reply'])
    expect(replies[0].id).not.toBe(replies[1].id)
  })

  // http://127.0.0.1:5174 — AIRI-046: VAD starts without ASR starts reused the previous message ID.
  // ROOT CAUSE: VAD did not allocate a turn. A separate provider item ID now correlates late and duplicate finals.
  it('aIRI-046 separates VAD-led user turns and deduplicates their final packets', async () => {
    const app = await fixture()
    const client = await app.client()
    await client.send({ type: 'config:save', id: 'save', config: { ...defaultVoiceConfig, apiKey: 'test-credential' } })
    await vi.waitFor(() => expect(client.events.length).toBe(1))
    let upstreamSocket: WsSocket | undefined
    app.upstream.on('connection', (socket) => {
      upstreamSocket = socket
      socket.once('message', () => socket.send(JSON.stringify({ type: 'session.created' })))
    })
    await client.send({ type: 'start', start: { instructions: 'Generated test', history: [], slowBrain: false } })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'ready' }))
    for (const index of [1, 2]) {
      upstreamSocket?.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }))
      upstreamSocket?.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: `Generated partial ${index}` }))
      const final = { type: 'conversation.item.input_audio_transcription.completed', item_id: `generated-vad-${index}`, transcript: `Generated final ${index}` }
      upstreamSocket?.send(JSON.stringify(final))
      upstreamSocket?.send(JSON.stringify(final))
    }
    await vi.waitFor(() => expect(client.events.filter(event => event.type === 'transcript' && event.role === 'user' && event.final)).toHaveLength(4))
    const users = client.events.filter((event): event is Extract<VoiceEvent, { type: 'transcript' }> => event.type === 'transcript' && event.role === 'user' && event.final)
    expect(users[0].id).toBe(users[1].id)
    expect(users[2].id).toBe(users[3].id)
    expect(users[0].id).not.toBe(users[2].id)
  })

  // http://127.0.0.1:5174 — AIRI-043: an old task receipt canceled the next user turn.
  // ROOT CAUSE: delegation was global. Receipts now retain their input turn and cannot cancel the next response.
  it.each([true, false])('aIRI-043 keeps the next native response audible after a late task receipt, ASR start=%s', async (started) => {
    const app = await fixture()
    const client = await app.client()
    await client.send({ type: 'config:save', id: 'save', config: { ...defaultVoiceConfig, apiKey: 'test-credential' } })
    await vi.waitFor(() => expect(client.events.length).toBe(1))
    let upstreamSocket: WsSocket | undefined
    const sent: Array<{ type: string }> = []
    app.upstream.on('connection', (socket) => {
      upstreamSocket = socket
      socket.on('message', data => sent.push(JSON.parse(data.toString())))
      socket.once('message', () => socket.send(JSON.stringify({ type: 'session.created' })))
    })
    await client.send({ type: 'start', start: { instructions: 'Character', history: [], slowBrain: true } })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'ready' }))
    const emit = (message: object) => upstreamSocket?.send(JSON.stringify(message))
    emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'task-turn', transcript: '帮我准备练唱方法' })
    emit({ type: 'response.function_call_arguments.done', response_id: 'task-response', items: [{ call_id: 'task-call', name: 'spawn_thinking', arguments: '{"objective":"准备练唱方法"}' }] })
    await vi.waitFor(() => expect(client.events.some(event => event.type === 'tools')).toBe(true))
    if (started)
      emit({ type: 'conversation.item.input_audio_transcription.started', item_id: 'next-turn' })
    emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'next-turn', transcript: '先聊聊你喜欢什么歌' })
    await vi.waitFor(() => expect(client.events).toContainEqual(expect.objectContaining({ type: 'transcript', role: 'user', text: '先聊聊你喜欢什么歌', final: true })))
    await client.send({ type: 'tool-results', results: [{ callId: 'task-call', output: '{"accepted":true}' }] })
    await vi.waitFor(() => expect(sent.some(message => message.type === 'conversation.item.create')).toBe(true))
    emit({ type: 'response.created', response_id: 'next-response' })
    emit({ type: 'response.output_text.done', response_id: 'next-response', text: '我喜欢轻快的旋律。' })
    emit({ type: 'response.output_audio.started', response_id: 'next-response', tts_type: 'chat_tts' })
    const pcm = Buffer.alloc(640).toString('base64')
    emit({ type: 'response.output_audio.delta', response_id: 'next-response', delta: pcm })
    emit({ type: 'response.output_audio.done', response_id: 'next-response' })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'audio', audio: pcm }))
    expect(client.events).toContainEqual(expect.objectContaining({ type: 'transcript', role: 'assistant', text: '我喜欢轻快的旋律。' }))
    expect(sent.filter(message => message.type === 'response.cancel')).toHaveLength(0)
  })

  // http://127.0.0.1:5174 — AIRI-036: a disconnected browser must not crash the gateway.
  it('aIRI-036 drops a configuration reply after its client disconnects and serves the next client', async () => {
    const app = await fixture()
    const status = { ...defaultVoiceConfig, configured: false }
    let finish!: (value: typeof status) => void
    const read = vi.spyOn(VoiceConfigFile.prototype, 'status').mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve
    }))
    const first = await app.client()
    await first.send({ type: 'config:get', id: 'closed-config' })
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    const closed = once(first.socket, 'close')
    first.socket.close()
    await closed
    finish(status)
    const next = await app.client()
    await next.send({ type: 'config:get', id: 'next-config' })
    await vi.waitFor(() => expect(next.events).toContainEqual(expect.objectContaining({ type: 'config', id: 'next-config' })))
    read.mockRestore()
  })

  // http://127.0.0.1:5174 — AIRI-022: FC handoff retained responding, and old audio-done could confirm new speech.
  // ROOT CAUSE: handoff never released activity; supplied TTS had no correlation or duplicate completion guard.
  it('aIRI-022 releases silent tool handoff and correlates supplied speech with provider audio', async () => {
    const app = await fixture()
    const client = await app.client()
    await client.send({ type: 'config:save', id: 'save', config: { ...defaultVoiceConfig, apiKey: 'test-credential' } })
    await vi.waitFor(() => expect(client.events.length).toBe(1))
    let upstreamSocket: WsSocket | undefined
    app.upstream.on('connection', (socket) => {
      upstreamSocket = socket
      socket.once('message', () => socket.send(JSON.stringify({ type: 'session.created' })))
    })
    await client.send({ type: 'start', start: { instructions: 'Character', history: [], slowBrain: true } })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'ready' }))
    const emit = (message: object) => upstreamSocket?.send(JSON.stringify(message))
    emit({ type: 'conversation.item.input_audio_transcription.completed', transcript: '查询记录' })
    emit({ type: 'response.function_call_arguments.done', response_id: 'native-1', items: [{ call_id: 'task-call', name: 'spawn_thinking', arguments: '{"objective":"查询记录"}' }] })
    await vi.waitFor(() => expect(client.events.at(-1)).toEqual({ type: 'activity', speaking: false, responding: false }))
    await client.send({ type: 'tool-results', results: [{ callId: 'task-call', output: '{"accepted":true}' }] })
    await client.send({ type: 'speak', id: 'application-speech', text: '我来处理一下。' })
    emit({ type: 'response.output_audio.started', response_id: 'tts-1', tts_type: 'chat_tts_text' })
    emit({ type: 'response.done', response: { id: 'native-1' } })
    const pcm = Buffer.alloc(640).toString('base64')
    emit({ type: 'response.output_audio.delta', delta: pcm })
    emit({ type: 'response.output_audio.done', response_id: 'tts-1' })
    emit({ type: 'response.output_audio.done', response_id: 'tts-1' })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'audio', speechId: 'application-speech', audio: pcm }))
    expect(client.events.filter(event => event.type === 'audio-done')).toEqual([{ type: 'audio-done', speechId: 'application-speech' }])
    await client.send({ type: 'speak', id: 'application-result', text: '记录已经核对好了。' })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'transcript', id: 'application-result', role: 'assistant', text: '记录已经核对好了。', final: true }))
    emit({ type: 'response.output_audio.started', response_id: 'tts-2', tts_type: 'chat_tts_text' })
    emit({ type: 'response.output_audio.started', response_id: 'late-native' })
    emit({ type: 'response.done', response: { usage: {} } })
    emit({ type: 'response.output_audio.done', response_id: 'tts-1' })
    emit({ type: 'response.output_audio.delta', delta: pcm })
    emit({ type: 'response.output_audio.done', response_id: 'tts-2' })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'audio-done', speechId: 'application-result' }))
    expect(client.events.filter(event => event.type === 'audio')).toEqual([{ type: 'audio', speechId: 'application-speech', audio: pcm }, { type: 'audio', speechId: 'application-result', audio: pcm }])
    expect(client.events.filter(event => event.type === 'audio-done')).toHaveLength(2)
  })

  // http://127.0.0.1:5174 — AIRI-021: selecting a worker after call start did not update the provider tools.
  // ROOT CAUSE: context updated instructions only; the delegation tools stayed fixed at session.create.
  it('aIRI-021 enables and removes delegation tools without replacing the active voice session', async () => {
    const app = await fixture()
    const client = await app.client()
    await client.send({ type: 'config:save', id: 'save', config: { ...defaultVoiceConfig, apiKey: 'test-credential' } })
    await vi.waitFor(() => expect(client.events.length).toBe(1))
    const messages: Array<Record<string, unknown>> = []
    app.upstream.on('connection', (socket) => {
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString())
        messages.push(message)
        if (message.type === 'session.create')
          socket.send(JSON.stringify({ type: 'session.created' }))
      })
    })
    await client.send({ type: 'start', start: { instructions: 'Character', history: [], slowBrain: false } })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'ready' }))
    await client.send({ type: 'context', instructions: 'Configured worker with web_search', slowBrain: true })
    await vi.waitFor(() => expect(messages.findLast(message => message.type === 'session.update')).toMatchObject({ session: { tools: expect.arrayContaining([expect.objectContaining({ name: 'spawn_thinking' })]) } }))
    await client.send({ type: 'context', instructions: 'Worker unavailable', slowBrain: false })
    await vi.waitFor(() => expect(messages.findLast(message => message.type === 'session.update')).toMatchObject({ session: {
      instructions: 'Worker unavailable',
      model: defaultVoiceConfig.model,
      audio: { output: { voice: defaultVoiceConfig.voice } },
      tools: expect.not.arrayContaining([expect.objectContaining({ name: 'spawn_thinking' })]),
    }, extension: { dialog: { extra: { enable_volc_websearch: false } } } }))
    expect(messages.filter(message => message.type === 'session.create')).toHaveLength(1)
  })

  // AIRI-016: live Seeduplex greeting events return audio only. Record known TTS text locally, not a fabricated model answer.
  it('records supplied speech text and preserves tool calls across context updates', async () => {
    const app = await fixture()
    const client = await app.client()
    await client.send({ type: 'config:save', id: 'save', config: { ...defaultVoiceConfig, apiKey: 'test-credential' } })
    await vi.waitFor(() => expect(client.events.length).toBe(1))
    const messages: Array<Record<string, unknown>> = []
    let upstreamSocket: WsSocket | undefined
    app.upstream.on('connection', (socket) => {
      upstreamSocket = socket
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString())
        messages.push(message)
        if (message.type === 'session.create')
          socket.send(JSON.stringify({ type: 'session.created' }))
      })
    })
    await client.send({ type: 'start', start: { instructions: 'Character', history: [], slowBrain: true } })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'ready' }))
    await client.send({ type: 'input-mute', muted: true })
    await client.send({ type: 'speak', id: 'background-speech', text: 'Hello from the background worker' })
    await client.send({ type: 'context', slowBrain: true, instructions: 'Current facts' })
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'speech_text_buffer.commit', event_id: expect.any(String), text: 'Hello from the background worker' }))
    expect(client.events).toContainEqual({ type: 'transcript', role: 'assistant', id: expect.any(String), text: 'Hello from the background worker', final: true })
    expect(messages.some(message => message.type === 'input_audio_mute.commit')).toBe(true)
    expect(messages.find(message => message.type === 'session.update')).toMatchObject({ session: {
      model: '1.2.6.1',
      audio: { output: { voice: defaultVoiceConfig.voice } },
      tools: expect.arrayContaining([expect.objectContaining({ name: 'spawn_thinking' })]),
    } })
    const calls = [{ call_id: 'call-1', name: 'spawn_thinking', arguments: '{"objective":"Read records"}' }]
    upstreamSocket?.send(JSON.stringify({ type: 'response.function_call_arguments.done', items: calls }))
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'tools', calls }))
    await client.send({ type: 'tool-results', results: [{ callId: 'call-1', output: '{"accepted":true}' }] })
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'conversation.item.create', event_id: expect.any(String), items: [{ call_id: 'call-1', role: 'tool', content: [{ type: 'input_text', text: '{"accepted":true}' }] }] }))
    expect(messages.some(message => message.type === 'response.create')).toBe(false)
  })
  it('stores keys only on the server, keeps a blank replacement, and deletes the key', async () => {
    const app = await fixture()
    const client = await app.client()
    await client.send({ type: 'config:save', id: 'save', config: { ...defaultVoiceConfig, apiKey: 'test-credential' } })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'config', id: 'save', config: { ...defaultVoiceConfig, configured: true } }))
    expect(JSON.stringify(client.events)).not.toContain('test-credential')
    expect(JSON.parse(await readFile(app.path, 'utf8')).apiKey).toBe('test-credential')
    await client.send({ type: 'config:save', id: 'keep', config: { ...defaultVoiceConfig, apiKey: '', voice: 'other-voice' } })
    await vi.waitFor(() => expect(client.events.some(event => event.type === 'config' && event.id === 'keep')).toBe(true))
    expect(JSON.parse(await readFile(app.path, 'utf8')).apiKey).toBe('test-credential')
    await client.send({ type: 'config:delete', id: 'delete' })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'config', id: 'delete', config: { ...defaultVoiceConfig, configured: false } }))
    await expect(readFile(app.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects browser origins from other sites and DNS rebinding hostnames', async () => {
    const app = await fixture()
    for (const headers of [{ origin: 'https://example.com' }, { origin: app.origin, headers: { Host: 'evil.example:5173' } }]) {
      const socket = new actualWs.WebSocket(`${app.origin.replace('http:', 'ws:')}/api/realtime-voice`, headers)
      const failure = new Promise<Error>(resolve => socket.once('error', resolve))
      expect((await failure).message).toContain('403')
      socket.terminate()
    }
  })

  it('connects both sockets, gates capture on session.created, and returns transcripts, audio, and interruptions', async () => {
    const app = await fixture()
    const client = await app.client()
    await client.send({ type: 'config:save', id: 'save', config: { ...defaultVoiceConfig, apiKey: 'test-credential' } })
    await vi.waitFor(() => expect(client.events.length).toBe(1))
    const messages: Array<Record<string, unknown>> = []
    let upstreamSocket: WsSocket | undefined
    app.upstream.on('connection', (socket, request) => {
      upstreamSocket = socket
      expect(request.headers['x-api-key']).toBe('test-credential')
      expect(request.headers['x-api-resource-id']).toBe('volc.speech.dialog')
      socket.on('message', data => messages.push(JSON.parse(data.toString())))
    })
    await client.send({ type: 'start', start: { instructions: 'Character and Stranger identity', history: [{ role: 'user', text: 'Earlier text' }] } })
    await vi.waitFor(() => expect(messages[0]?.type).toBe('session.create'))
    expect(provider.requestedUrl).toBe('wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue')
    expect(messages[0]).toMatchObject({
      session: { model: '1.2.6.1', instructions: 'Character and Stranger identity', audio: { output: { format: { type: 'pcm_s16le', rate: 24000 } } } },
      extension: { dialog: { dialog_context: [{ role: 'user', text: 'Earlier text' }] } },
    })
    const frame = Buffer.alloc(640).toString('base64')
    await client.send({ type: 'audio', audio: frame })
    const second = await app.client()
    await second.send({ type: 'start', start: { instructions: '', history: [] } })
    await vi.waitFor(() => expect(second.events).toContainEqual({ type: 'error', code: 'busy' }))
    expect(messages.filter(message => message.type === 'input_audio_buffer.append')).toHaveLength(0)
    if (!upstreamSocket)
      throw new Error('Missing upstream connection')
    const emit = (message: object) => upstreamSocket?.send(JSON.stringify(message))
    emit({ type: 'session.created' })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'ready' }))
    await second.send({ type: 'speak', id: 'other-speech', text: 'unauthorized greeting' })
    await second.send({ type: 'context', slowBrain: false, instructions: 'unauthorized context' })
    await client.send({ type: 'speak', id: 'greeting-speech', text: '你好，陌生人！你叫什么名字？' })
    await client.send({ type: 'context', slowBrain: false, instructions: 'Character plus current local personal memories' })
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'speech_text_buffer.commit', event_id: expect.any(String), text: '你好，陌生人！你叫什么名字？' }))
    expect(messages.some(message => message.text === 'unauthorized greeting')).toBe(false)
    expect(messages.find(message => message.type === 'session.update')).toMatchObject({ session: { instructions: 'Character plus current local personal memories', model: '1.2.6.1' } })
    await client.send({ type: 'audio', audio: frame })
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'input_audio_buffer.append', audio: frame }))
    emit({ type: 'conversation.item.input_audio_transcription.started', item_id: 'u1' })
    await vi.waitFor(() => expect(client.events.at(-1)).toEqual({ type: 'activity', speaking: true, responding: false }))
    emit({ type: 'conversation.item.input_audio_transcription.delta', delta: '你好' })
    emit({ type: 'conversation.item.input_audio_transcription.completed', transcript: '你好世界' })
    emit({ type: 'response.output_text.delta', response_id: 'r1', delta: '你好，陌生人' })
    emit({ type: 'response.output_text.done', response_id: 'r1', text: '你好，陌生人' })
    emit({ type: 'response.output_text.done', response_id: 'r1', text: '你好，陌生人' })
    emit({ type: 'response.output_audio.started', response_id: 'r1' })
    emit({ type: 'response.output_audio.delta', delta: frame })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'audio', audio: frame }))
    expect(client.events).toContainEqual({ type: 'transcript', role: 'user', id: 'u1', text: '你好世界', final: true })
    expect(client.events.filter(event => event.type === 'transcript' && event.role === 'assistant' && event.final && event.text === '你好，陌生人')).toHaveLength(1)
    expect(client.events).toContainEqual({ type: 'interrupt' })
    await client.send({ type: 'cancel' })
    await vi.waitFor(() => expect(messages.some(message => message.type === 'response.cancel')).toBe(true))
    emit({ type: 'response.output_audio.delta', response_id: 'r1', delta: frame })
    await client.send({ type: 'stop' })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'stopped' }))
    expect(client.events.filter(event => event.type === 'audio')).toHaveLength(1)
    await vi.waitFor(() => expect(app.upstream.clients.size).toBe(0))
  })

  it('does not open a paid upstream session without a key', async () => {
    const app = await fixture()
    const client = await app.client()
    await client.send({ type: 'start', start: { instructions: '', history: [] } })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'error', code: 'not-configured' }))
    expect(app.upstream.clients.size).toBe(0)
  })

  it('redacts provider errors and releases the call slot after a failure', async () => {
    const app = await fixture()
    const client = await app.client()
    await client.send({ type: 'config:save', id: 'save', config: { ...defaultVoiceConfig, apiKey: 'test-credential' } })
    await vi.waitFor(() => expect(client.events.length).toBe(1))
    app.upstream.on('connection', (socket) => {
      socket.once('message', () => socket.send(JSON.stringify({ type: 'error', message: 'test-credential should not reach browser' })))
    })
    await client.send({ type: 'start', start: { instructions: '', history: [] } })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'stopped' }))
    expect(client.events).toContainEqual({ type: 'error', code: 'provider', requestId: expect.any(String) })
    expect(JSON.stringify(client.events)).not.toContain('test-credential')
    await client.send({ type: 'config:delete', id: 'after-failure' })
    await vi.waitFor(() => expect(client.events.some(event => event.type === 'config' && event.id === 'after-failure')).toBe(true))
  })

  it('ends an interrupted turn once, drops late audio, and starts the next turn with a new ID', async () => {
    const app = await fixture()
    const client = await app.client()
    await client.send({ type: 'config:save', id: 'save', config: { ...defaultVoiceConfig, apiKey: 'test-credential' } })
    await vi.waitFor(() => expect(client.events.length).toBe(1))
    const messages = [
      { type: 'session.created' },
      { type: 'response.output_text.delta', response_id: 'first', delta: 'unfinished' },
      { type: 'input_audio_buffer.speech_started' },
      { type: 'response.output_audio.delta', response_id: 'first', delta: Buffer.alloc(640).toString('base64') },
      { type: 'response.canceled', response_id: 'first' },
      { type: 'response.created', response_id: 'second' },
      { type: 'response.output_text.delta', response_id: 'second', delta: 'new reply' },
      { type: 'response.output_text.done', response_id: 'second', text: 'new reply' },
    ]
    app.upstream.on('connection', (socket) => {
      socket.once('message', () => messages.forEach(message => socket.send(JSON.stringify(message))))
    })
    await client.send({ type: 'start', start: { instructions: '', history: [] } })
    await vi.waitFor(() => expect(client.events).toContainEqual({ type: 'transcript', role: 'assistant', id: 'second', text: 'new reply', final: true }))
    expect(client.events.filter(event => event.type === 'transcript' && event.final)).toHaveLength(2)
    expect(client.events).toContainEqual({ type: 'transcript', role: 'assistant', id: 'first', text: 'unfinished', final: true, interrupted: true })
    expect(client.events.some(event => event.type === 'audio')).toBe(false)
    client.socket.close()
    await vi.waitFor(() => expect(app.upstream.clients.size).toBe(0))
  })

  it('merges repeated cumulative ASR hypotheses without repeating words', () => {
    expect(mergeTranscript('你好', '你好世界')).toBe('你好世界')
    expect(mergeTranscript('你好世界', '世界和平')).toBe('你好世界和平')
    expect(mergeTranscript('你好世界', '你好')).toBe('你好世界')
  })

  // http://127.0.0.1:5174 — AIRI-011, corrected speech hypotheses become a malformed persistent name.
  // ROOT CAUSE:
  // Cumulative and final ASR events were merged with drafts. They now replace drafts, so corrected names stay intact.
  it('aIRI-011 replaces partial ASR with cumulative and final corrected names', async () => {
    const app = await fixture()
    const client = await app.client()
    await client.send({ type: 'config:save', id: 'save', config: { ...defaultVoiceConfig, apiKey: 'test-credential' } })
    await vi.waitFor(() => expect(client.events.length).toBe(1))
    app.upstream.on('connection', (socket) => {
      socket.once('message', () => {
        for (const message of [
          { type: 'session.created' },
          { type: 'conversation.item.input_audio_transcription.started', item_id: 'intro' },
          { type: 'conversation.item.input_audio_transcription.delta', delta: '我叫桃' },
          { type: 'conversation.item.input_audio_transcription.result', transcript: '我叫陶新宇' },
          { type: 'conversation.item.input_audio_transcription.completed', transcript: '我叫陶心宇' },
        ]) {
          socket.send(JSON.stringify(message))
        }
      })
    })
    await client.send({ type: 'start', start: { instructions: '', history: [] } })
    await vi.waitFor(() => expect(client.events.some(event => event.type === 'transcript' && event.final)).toBe(true))
    expect(client.events).toContainEqual({ type: 'transcript', role: 'user', id: 'intro', text: '我叫陶心宇', final: true })
  })
})
