import { createContext, defineEventa } from '@moeru/eventa'

import * as v from 'valibot'

export const voicePath = '/api/realtime-voice'
export const defaultVoiceConfig = {
  model: '1.2.6.1',
  voice: 'zh_female_vv_jupiter_bigtts',
  resourceId: 'volc.speech.dialog',
}

const shortText = v.pipe(v.string(), v.maxLength(256))
export const voiceConfigSchema = v.object({
  apiKey: v.pipe(v.string(), v.maxLength(4096), v.check(value => !/[\r\n]/.test(value))),
  model: shortText,
  voice: shortText,
  resourceId: v.pipe(shortText, v.check(value => !/[\r\n]/.test(value))),
})
export type VoiceConfig = v.InferOutput<typeof voiceConfigSchema>
export interface VoiceConfigStatus extends Omit<VoiceConfig, 'apiKey'> { configured: boolean }

export const voiceStartSchema = v.object({
  slowBrain: v.optional(v.boolean()),
  instructions: v.pipe(v.string(), v.maxLength(16000)),
  history: v.pipe(v.array(v.object({
    role: v.picklist(['user', 'assistant']),
    text: v.pipe(v.string(), v.maxLength(4000)),
  })), v.maxLength(24), v.check(history => history.reduce((length, item) => length + item.text.length, 0) <= 12000)),
})
export type VoiceStart = v.InferOutput<typeof voiceStartSchema>

export const voiceCommandSchema = v.variant('type', [
  v.object({ type: v.literal('config:get'), id: shortText }),
  v.object({ type: v.literal('config:save'), id: shortText, config: voiceConfigSchema }),
  v.object({ type: v.literal('config:delete'), id: shortText }),
  v.object({ type: v.literal('start'), start: voiceStartSchema }),
  v.object({ type: v.literal('audio'), audio: v.pipe(v.string(), v.length(856)) }),
  v.object({ type: v.literal('cancel') }),
  v.object({ type: v.literal('input-mute'), muted: v.boolean() }),
  v.object({ type: v.literal('tool-results'), results: v.pipe(v.array(v.object({ callId: shortText, output: v.pipe(v.string(), v.maxLength(16000)) })), v.maxLength(16)) }),
  v.object({ type: v.literal('speak'), id: shortText, text: v.pipe(v.string(), v.minLength(1), v.maxLength(1000)) }),
  v.object({ type: v.literal('context'), slowBrain: v.boolean(), instructions: v.pipe(v.string(), v.maxLength(16000)) }),
  v.object({ type: v.literal('stop') }),
])
export type VoiceCommand = v.InferOutput<typeof voiceCommandSchema>
export const voiceEventSchema = v.variant('type', [
  v.object({ type: v.literal('config'), id: shortText, config: v.object({
    configured: v.boolean(),
    model: shortText,
    voice: shortText,
    resourceId: shortText,
  }) }),
  v.object({ type: v.literal('ready') }),
  v.object({ type: v.literal('stopped') }),
  v.object({ type: v.literal('interrupt') }),
  v.object({ type: v.literal('audio-done'), speechId: v.optional(shortText) }),
  v.object({ type: v.literal('tools'), calls: v.pipe(v.array(v.object({ call_id: shortText, name: shortText, arguments: v.pipe(v.string(), v.maxLength(8000)) })), v.maxLength(16)) }),
  v.object({ type: v.literal('activity'), speaking: v.boolean(), responding: v.boolean() }),
  v.object({ type: v.literal('audio'), speechId: v.optional(shortText), audio: v.pipe(v.string(), v.maxLength(2000000)) }),
  v.object({ type: v.literal('transcript'), role: v.picklist(['user', 'assistant']), id: shortText, text: v.pipe(v.string(), v.maxLength(16000)), final: v.boolean(), interrupted: v.optional(v.boolean()) }),
  v.object({ type: v.literal('error'), code: shortText, id: v.optional(shortText), requestId: v.optional(shortText) }),
])
export type VoiceEvent = v.InferOutput<typeof voiceEventSchema>
export const voiceCommand = defineEventa<VoiceCommand>('airi:realtime:command')
export const voiceEvent = defineEventa<VoiceEvent>('airi:realtime:event')

/** Owns the validated Eventa boundary. Audio and control use the same ordered WebSocket. */
export class VoiceChannel {
  readonly context = createContext()
  private readonly unsubscribe: () => void

  constructor(private readonly side: 'client' | 'server', send: (data: string) => void) {
    this.unsubscribe = side === 'client'
      ? this.context.on(voiceCommand, event => send(JSON.stringify(event.body)))
      : this.context.on(voiceEvent, event => send(JSON.stringify(event.body)))
  }

  async receive(data: string) {
    const body: unknown = JSON.parse(data)
    if (this.side === 'client')
      await this.context.emit(voiceEvent, v.parse(voiceEventSchema, body))
    else
      await this.context.emit(voiceCommand, v.parse(voiceCommandSchema, body))
  }

  dispose() {
    this.unsubscribe()
    this.context.abort(new Error('Voice channel closed'))
  }
}
