import type { VoiceConfig, VoiceEvent, VoiceStart } from './contracts'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { WebSocket } from 'ws'

import * as v from 'valibot'

import { brainTools } from './brain'

const providerEventSchema = v.looseObject({
  type: v.string(),
  delta: v.optional(v.string()),
  text: v.optional(v.string()),
  transcript: v.optional(v.string()),
  item_id: v.optional(v.string()),
  response_id: v.optional(v.string()),
  tts_type: v.optional(v.string()),
  items: v.optional(v.array(v.object({ call_id: v.string(), name: v.string(), arguments: v.string() }))),
})

/** ASR sends both incremental text and cumulative hypotheses within the same utterance. */
export function mergeTranscript(previous: string, next: string) {
  if (!next || previous === next)
    return previous
  if (next.startsWith(previous))
    return next
  if (previous.startsWith(next))
    return previous
  for (let size = Math.min(previous.length, next.length); size > 0; size--) {
    if (previous.endsWith(next.slice(0, size)))
      return previous + next.slice(size)
  }
  return previous + next
}

/** Converts AIRI context to the JSON full-duplex API from the supplied September 2026 reference. */
export function createDoubaoSession(config: VoiceConfig, start: VoiceStart) {
  return {
    type: 'session.create',
    event_id: randomUUID(),
    session: {
      model: config.model,
      instructions: start.instructions,
      tools: brainTools(start.slowBrain === true),
      audio: {
        input: { format: { type: 'pcm', rate: 16000 } },
        output: { format: { type: 'pcm_s16le', rate: 24000 }, voice: config.voice, speed: 0 },
      },
    },
    extension: {
      asr: { extra: {} },
      tts: { extra: {}, audio_config: { channel: 1, format: 'pcm_s16le', sample_rate: 24000 } },
      dialog: { dialog_context: start.history, extra: { strict_audit: true, enable_volc_websearch: false } },
    },
  }
}

/** One upstream session. The API key never appears in events, logs, URLs, or error messages. */
export class DoubaoSession {
  private readonly socket: WebSocket
  private readonly connectTimer: ReturnType<typeof setTimeout>
  private readonly durationTimer: ReturnType<typeof setTimeout>
  private closeTimer?: ReturnType<typeof setTimeout>
  private closed = false
  private ready = false
  private userId: string = randomUUID()
  private userItemId?: string
  private assistantId: string = randomUUID()
  private userText = ''
  private assistantText = ''
  private assistantFinished = true
  private readonly completedResponses = new Set<string>()
  private canceledResponseId?: string
  private suppressAudio = false
  private userSpeaking = false
  private inputTurn = 0
  private readonly sessionPayload: ReturnType<typeof createDoubaoSession>
  private readonly pendingCalls = new Set<string>()
  private readonly callOrigins = new Map<string, { name: string, turn: number, responseId?: string }>()
  private readonly delegatedResponses = new Set<string>()
  private readonly completedCalls = new Set<string>()
  private readonly speechIds = new Set<string>()
  private readonly finishedAudio = new Set<string>()
  private pendingSpeech?: string
  private currentAudio?: { responseId: string, speechId?: string, suppressed: boolean }
  private delegated = false
  readonly requestId = randomUUID()

  constructor(config: VoiceConfig, start: VoiceStart, private readonly emit: (event: VoiceEvent) => void) {
    this.sessionPayload = createDoubaoSession(config, start)
    this.socket = new WebSocket('wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue', {
      headers: { 'X-Api-Key': config.apiKey, 'X-Api-Resource-Id': config.resourceId, 'X-Api-Connect-Id': this.requestId },
      handshakeTimeout: 15000,
      maxPayload: 4 * 1024 * 1024,
    })
    this.connectTimer = setTimeout(() => this.fail('timeout'), 20000)
    this.durationTimer = setTimeout(() => this.fail('duration-limit'), 10 * 60 * 1000)
    this.socket.on('open', () => {
      if (!this.closed)
        this.send(this.sessionPayload)
    })
    this.socket.on('message', (data) => {
      if (this.closed) {
        try {
          if (JSON.parse(data.toString()).type === 'session.closed') {
            clearTimeout(this.closeTimer)
            this.socket.close()
          }
        }
        catch { /* The close timer releases malformed or missing acknowledgements. */ }
        return
      }
      try {
        this.receive(v.parse(providerEventSchema, JSON.parse(data.toString())))
      }
      catch {
        this.fail('protocol')
      }
    })
    this.socket.on('unexpected-response', (_request, response) => {
      response.resume()
      this.fail(response.statusCode === 401 || response.statusCode === 403 ? 'authentication' : 'provider')
    })
    this.socket.on('error', () => this.fail('connection'))
    this.socket.on('close', () => {
      if (!this.closed)
        this.fail('connection')
      clearTimeout(this.closeTimer)
    })
  }

  private send(message: object) {
    if (this.socket.readyState !== WebSocket.OPEN)
      return
    if (this.socket.bufferedAmount > 256 * 1024) {
      this.fail('backpressure')
      return
    }
    this.socket.send(JSON.stringify(message))
  }

  private fail(code: string) {
    if (this.closed)
      return
    this.emit({ type: 'error', code, requestId: this.requestId })
    this.stop()
  }

  /** VAD and ASR starts can describe the same turn. Provider item IDs bind late finals without changing its displayed ID. */
  private beginInput(itemId?: string) {
    this.inputTurn++
    this.userSpeaking = true
    this.userItemId = itemId
    this.userId = itemId ?? randomUUID()
    this.userText = ''
    this.delegated = false
    this.interruptResponse()
  }

  private receive(message: v.InferOutput<typeof providerEventSchema>) {
    switch (message.type) {
      case 'session.created':
        clearTimeout(this.connectTimer)
        this.ready = true
        this.emit({ type: 'ready' })
        break
      case 'input_audio_buffer.speech_started':
      case 'conversation.item.input_audio_transcription.started':
        if (!this.userSpeaking) {
          this.beginInput(message.item_id)
        }
        else if (message.type.endsWith('transcription.started') && !this.userItemId) {
          this.userItemId = message.item_id
          if (!this.userText && message.item_id)
            this.userId = message.item_id
        }
        break
      case 'conversation.item.input_audio_transcription.delta':
        this.userText = mergeTranscript(this.userText, message.delta ?? '')
        this.transcript('user', false)
        break
      case 'conversation.item.input_audio_transcription.result':
      case 'conversation.item.input_audio_transcription.completed':
        // A complete ASR item also identifies a new turn when no start event preceded it.
        if (!this.userSpeaking && message.item_id !== this.userItemId)
          this.beginInput(message.item_id)
        else if (this.userSpeaking && !this.userItemId)
          this.userItemId = message.item_id
        // Cumulative and final text replace draft hypotheses, including corrected characters in a person's name.
        this.userText = message.transcript ?? message.text ?? this.userText
        this.transcript('user', message.type.endsWith('completed'))
        if (message.type.endsWith('completed')) {
          this.userSpeaking = false
          this.emit({ type: 'activity', speaking: false, responding: true })
        }
        break
      case 'response.output_audio.started':
        if (!message.response_id || this.finishedAudio.has(message.response_id))
          break
        if (this.pendingSpeech && message.tts_type !== 'chat_tts_text')
          break
        this.currentAudio = { responseId: message.response_id, speechId: message.tts_type === 'chat_tts_text' ? this.pendingSpeech : undefined, suppressed: message.tts_type === 'chat_tts_text' ? !this.pendingSpeech : this.delegated || this.delegatedResponses.has(message.response_id) || !!this.pendingSpeech }
        this.suppressAudio = this.currentAudio.suppressed
        if (this.suppressAudio)
          break
        this.emit({ type: 'activity', speaking: this.userSpeaking, responding: true })
        break
      case 'response.output_audio.done': {
        const audio = this.currentAudio
        if (!audio || message.response_id !== audio.responseId || this.finishedAudio.has(audio.responseId))
          break
        this.finishedAudio.add(audio.responseId)
        if (this.finishedAudio.size > 256)
          this.finishedAudio.delete(this.finishedAudio.values().next().value!)
        this.currentAudio = undefined
        if (audio.suppressed)
          break
        this.emit({ type: 'audio-done', ...(audio.speechId ? { speechId: audio.speechId } : {}) })
        if (audio.speechId === this.pendingSpeech)
          this.pendingSpeech = undefined
        this.emit({ type: 'activity', speaking: this.userSpeaking, responding: false })
        break
      }
      case 'response.done':
        // Real Seeduplex response.done contains usage, without a response ID. It cannot finish a newer TTS stream.
        if (!this.pendingSpeech && !this.currentAudio)
          this.emit({ type: 'activity', speaking: this.userSpeaking, responding: false })
        break
      case 'response.function_call_arguments.done': {
        const calls = message.items?.filter(item => !this.pendingCalls.has(item.call_id) && !this.completedCalls.has(item.call_id))
        if (!calls?.length)
          break
        for (const call of calls) {
          this.pendingCalls.add(call.call_id)
          this.callOrigins.set(call.call_id, { name: call.name, turn: this.inputTurn, responseId: message.response_id })
        }
        this.emit({ type: 'tools', calls })
        this.emit({ type: 'activity', speaking: this.userSpeaking, responding: false })
        break
      }
      case 'response.created':
        if (message.response_id && (message.response_id === this.assistantId || this.completedResponses.has(message.response_id)))
          break
        if (!this.assistantFinished)
          this.transcript('assistant', true, true)
        this.assistantId = message.response_id ?? randomUUID()
        this.assistantText = ''
        this.assistantFinished = false
        this.suppressAudio = false
        break
      case 'response.output_text.delta':
      case 'response.output_text.done':
        if (this.pendingSpeech || this.delegated || (message.response_id && this.delegatedResponses.has(message.response_id)))
          break
        if (message.response_id && this.completedResponses.has(message.response_id))
          break
        // Responses can legitimately repeat a short answer. Only an unkeyed repeat inside this response is a duplicate.
        if (this.assistantFinished && !message.response_id && message.type.endsWith('.done') && message.text === this.assistantText)
          break
        if (message.response_id && message.response_id === this.canceledResponseId)
          break
        if (this.assistantFinished) {
          this.assistantId = message.response_id ?? randomUUID()
          this.assistantText = ''
          this.assistantFinished = false
          this.suppressAudio = false
        }
        this.assistantText = message.type.endsWith('.done') ? message.text ?? this.assistantText : this.assistantText + (message.delta ?? '')
        this.assistantFinished = message.type.endsWith('.done')
        this.transcript('assistant', this.assistantFinished)
        if (this.assistantFinished && message.response_id) {
          this.completedResponses.add(message.response_id)
          if (this.completedResponses.size > 256)
            this.completedResponses.delete(this.completedResponses.values().next().value!)
        }
        break
      case 'response.output_audio.delta': {
        if (!this.currentAudio || this.suppressAudio || this.currentAudio.suppressed || (message.response_id && message.response_id !== this.currentAudio.responseId))
          break
        const audio = message.delta ?? ''
        if (!audio)
          break
        const bytes = Buffer.from(audio, 'base64')
        if (!bytes.length || bytes.length % 2 !== 0 || bytes.toString('base64') !== audio)
          throw new Error('Invalid PCM16')
        this.emit({ type: 'audio', audio, ...(this.currentAudio.speechId ? { speechId: this.currentAudio.speechId } : {}) })
        break
      }
      case 'response.canceled':
        // A cancellation ACK can arrive after the next response starts. It cannot interrupt that newer response.
        if (!this.assistantFinished && (!message.response_id || message.response_id === this.assistantId))
          this.interruptResponse()
        break
      case 'conversation.item.input_audio_transcription.failed':
      case 'error':
        this.fail('provider')
        break
      case 'session.closed':
        this.stop()
        break
    }
  }

  private transcript(role: 'user' | 'assistant', final: boolean, interrupted?: boolean) {
    const text = role === 'user' ? this.userText : this.assistantText
    if (text.length > 16000)
      throw new Error('Transcript limit')
    if (text)
      this.emit({ type: 'transcript', role, id: role === 'user' ? this.userId : this.assistantId, text, final, ...(interrupted ? { interrupted } : {}) })
  }

  private interruptResponse() {
    this.canceledResponseId = this.assistantId
    this.suppressAudio = true
    if (this.currentAudio)
      this.finishedAudio.add(this.currentAudio.responseId)
    if (this.finishedAudio.size > 256)
      this.finishedAudio.delete(this.finishedAudio.values().next().value!)
    this.currentAudio = undefined
    this.pendingSpeech = undefined
    if (!this.assistantFinished)
      this.transcript('assistant', true, true)
    this.assistantFinished = true
    this.emit({ type: 'interrupt' })
    this.emit({ type: 'activity', speaking: this.userSpeaking, responding: false })
  }

  appendAudio(audio: string) {
    if (!this.ready || this.closed)
      return
    const frame = Buffer.from(audio, 'base64')
    if (frame.length !== 640 || frame.toString('base64') !== audio) {
      this.fail('protocol')
      return
    }
    this.send({ type: 'input_audio_buffer.append', audio })
  }

  /** Uses the provider's greeting event. It creates no fictitious user message. */
  speak(id: string, text: string) {
    if (!this.ready || this.closed || this.speechIds.has(id))
      return
    if (this.pendingSpeech) {
      this.fail('speech-busy')
      return
    }
    this.speechIds.add(id)
    if (this.speechIds.size > 256)
      this.speechIds.delete(this.speechIds.values().next().value!)
    this.pendingSpeech = id
    this.suppressAudio = false
    // This event reads the supplied text; it does not produce output_text events or reason about a user query.
    this.assistantId = id
    this.assistantText = text
    this.assistantFinished = true
    this.transcript('assistant', true)
    this.emit({ type: 'activity', speaking: this.userSpeaking, responding: true })
    this.send({ type: 'speech_text_buffer.commit', event_id: id, text })
  }

  /** Replaces bounded live instructions. Visual evidence never accumulates in history. */
  context(instructions: string, slowBrain: boolean) {
    this.sessionPayload.session.instructions = instructions
    this.sessionPayload.session.tools = brainTools(slowBrain)
    if (this.ready && !this.closed) {
      // session.update replaces configuration. Preserve audio, tools, and extension on every context change.
      this.send({ ...this.sessionPayload, type: 'session.update', event_id: randomUUID() })
    }
  }

  muteInput(muted: boolean) {
    if (this.ready && !this.closed)
      this.send({ type: muted ? 'input_audio_mute.commit' : 'input_audio_unmute.commit', event_id: randomUUID() })
  }

  toolResults(results: { callId: string, output: string }[]) {
    if (!this.ready || this.closed || results.some(result => !this.pendingCalls.has(result.callId)))
      return
    const accepted = results.flatMap((result) => {
      const origin = this.callOrigins.get(result.callId)
      return origin?.name === 'spawn_thinking' && v.safeParse(v.object({ accepted: v.literal(true) }), JSON.parse(result.output)).success ? [origin] : []
    })
    for (const origin of accepted) {
      if (origin.responseId)
        this.delegatedResponses.add(origin.responseId)
    }
    while (this.delegatedResponses.size > 256)
      this.delegatedResponses.delete(this.delegatedResponses.values().next().value!)
    for (const result of results) {
      this.pendingCalls.delete(result.callId)
      this.callOrigins.delete(result.callId)
      this.completedCalls.add(result.callId)
    }
    if (this.completedCalls.size > 256)
      this.completedCalls.delete(this.completedCalls.values().next().value!)
    this.send({ type: 'conversation.item.create', event_id: randomUUID(), items: results.map(result => ({ call_id: result.callId, role: 'tool', content: [{ type: 'input_text', text: result.output }] })) })
    if (!this.userSpeaking && accepted.some(origin => origin.turn === this.inputTurn)) {
      // Application TTS owns this turn's acknowledgement. An older receipt cannot cancel a newer user response.
      this.delegated = true
      this.suppressAudio = true
      if (!this.pendingSpeech)
        this.send({ type: 'response.cancel', event_id: randomUUID() })
    }
  }

  cancel() {
    if (!this.ready || this.closed)
      return
    this.interruptResponse()
    this.send({ type: 'response.cancel', event_id: randomUUID() })
  }

  stop() {
    if (this.closed)
      return
    this.closed = true
    clearTimeout(this.connectTimer)
    clearTimeout(this.durationTimer)
    if (this.ready)
      this.send({ type: 'session.close', event_id: randomUUID() })
    this.closeTimer = setTimeout(() => this.socket.terminate(), 1200)
    if (!this.ready)
      this.socket.terminate()
    this.emit({ type: 'stopped' })
  }
}
