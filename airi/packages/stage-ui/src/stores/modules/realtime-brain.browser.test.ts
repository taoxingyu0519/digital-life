import type { GenerationProvider } from '@proj-airi/provider-inference'
import type { VoiceCommand, VoiceConfigStatus, VoiceEvent } from '@proj-airi/realtime-voice/contracts'

import en from '@proj-airi/i18n/locales/en'

import { createPlaybackManager, createSpeechPipeline } from '@proj-airi/pipelines-audio'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createApp, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import LocalVisionRuntime from '../../../../../apps/stage-web/src/components/local-vision-runtime.vue'
import Settings from '../../../../stage-pages/src/pages/settings/modules/realtime-voice.vue'
import Controls from '../../components/scenarios/realtime-voice-controls.vue'

import { useChatInput } from '../../composables/use-chat-input'
import { storage } from '../../database/storage'
import { setupSynced } from '../../libs/pinia'
import { registerLocalVisionContext } from '../../services/local-vision-context'
import { useAudioContext } from '../audio'
import { useChatStore } from '../chat'
import { useChatArchiveStore } from '../chat-archive'
import { useChatSessionStore } from '../chat/session-store'
import { useCompanionStore } from '../companion'
import { useLocalVisionStore } from '../local-vision'
import { useProviderConfigStore } from '../providers/config'
import { useSettingsAudioDevice } from '../settings'
import { useSpeechRuntimeStore } from '../speech-runtime'
import { useStageIdentityStore } from '../stage-identity'
import { useStageRuntimeStore } from '../stage-runtime'
import { useAiriCardStore } from './airi-card'
import { useBrainPromptsStore } from './brain-prompts'
import { useConsciousnessStore } from './consciousness'
import { useConsciousnessSettingsStore } from './consciousness-settings'
import { useRealtimeVoiceStore } from './realtime-voice'
import { useSlowBrainStore } from './slow-brain'
import { useSpeechStore } from './speech'
import { useWebSearchStore } from './web-search'

const boundary = vi.hoisted(() => ({
  clients: [] as Array<{ event: (event: VoiceEvent) => void, commands: VoiceCommand[] }>,
  playback: [] as Array<{ end: () => void }>,
  configured: true,
  configError: '',
  sendBarrier: undefined as ((command: VoiceCommand) => Promise<void>) | undefined,
  input: [] as Array<(frame: string) => void>,
}))

vi.mock('@proj-airi/realtime-voice/client', () => ({
  VoiceClient: class {
    private readonly connection: typeof boundary.clients[number]
    constructor(event: (event: VoiceEvent) => void) {
      this.connection = { event, commands: [] }
      boundary.clients.push(this.connection)
    }

    async config(): Promise<VoiceConfigStatus> {
      if (boundary.configError)
        throw new Error(boundary.configError)
      return { configured: boundary.configured, model: '1.2.6.1', voice: 'voice', resourceId: 'volc.speech.dialog' }
    }

    async send(command: VoiceCommand) {
      this.connection.commands.push(command)
      if (command.type === 'start')
        this.connection.event({ type: 'ready' })
      await boundary.sendBarrier?.(command)
    }

    close() {}
  },
}))

vi.mock('@proj-airi/realtime-voice/audio', () => ({
  RealtimeAudio: class {
    readonly output: GainNode
    constructor(context: AudioContext, _url: string, private readonly onSpeaking: (speaking: boolean) => void) {
      this.output = context.createGain()
      boundary.playback.push({ end: () => onSpeaking(false) })
    }

    async start(onFrame: (frame: string) => void) { boundary.input.push(onFrame) }
    play() { this.onSpeaking(true) }
    interrupt() { this.onSpeaking(false) }
    setMuted() {}
    close() { this.onSpeaking(false) }
  },
}))

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  boundary.clients = []
  boundary.playback = []
  boundary.configured = true
  boundary.configError = ''
  boundary.sendBarrier = undefined
  boundary.input = []
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
})

async function fixture(showSettings = false, withCamera = false) {
  localStorage.clear()
  if (withCamera)
    await fetch('/api/local-vision/test-reset', { method: 'POST' })
  const pinia = createPinia()
  const synced = setupSynced({ leadership: 'leader-only' })
  pinia.use(synced.pinia)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] })
  await router.push('/')
  let input!: ReturnType<typeof useChatInput>
  const app = createApp({ setup() {
    input = useChatInput()
    useSpeechStore()
    const audio = useAudioContext()
    return () => h('div', [h('button', { onClick: () => void audio.audioContext.resume() }, 'Unlock test audio'), h(Controls), ...(showSettings ? [h(Settings)] : []), ...(withCamera ? [h(LocalVisionRuntime)] : [])])
  } })
  const container = document.createElement('div')
  document.body.append(container)
  app.use(pinia).use(synced.vue).use(router).use(createI18n({ legacy: false, locale: 'en', messages: { en } })).mount(container)
  const voice = useRealtimeVoiceStore(pinia)
  const sessions = useChatSessionStore(pinia)
  const consciousness = useConsciousnessStore(pinia)
  await sessions.initialize()
  // Browser IndexedDB outlives Pinia. Each fixture uses a fresh conversation, without deleting persistent test records.
  await sessions.createSession('default')
  await voice.refreshConfig()
  voice.continuationDelaySeconds = 2
  await userEvent.click(container.querySelector('button')!)
  cleanups.push(() => {
    app.unmount()
    disposePinia(pinia)
    container.remove()
  })
  return { voice, sessions, consciousness, input, container }
}

function connection() {
  const client = boundary.clients.findLast(client => client.commands.some(command => command.type === 'start'))
  if (!client)
    throw new Error('No test voice connection')
  return client
}

function reply(text: string) {
  return new Response([
    `data: ${JSON.stringify({ id: 'completion', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id: 'completion', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join(''), { headers: { 'Content-Type': 'text/event-stream' } })
}

function completeSpeech(client: ReturnType<typeof connection>, narration: Extract<VoiceCommand, { type: 'speak' }>) {
  client.event({ type: 'audio', speechId: narration.id, audio: btoa('\0\0') })
  client.event({ type: 'transcript', id: narration.id, role: 'assistant', text: narration.text, final: true })
  client.event({ type: 'audio-done', speechId: narration.id })
  boundary.playback.at(-1)!.end()
}

describe('realtime brain browser integration', () => {
  // http://127.0.0.1:5174 — AIRI-046: live spoken captions never reached the stage history until playback drained.
  // ROOT CAUSE: history consumed only committed records. Local captions now feed the same history without confirming playback.
  it('aIRI-046 exposes live captions and replaces them with one confirmed history record', async () => {
    const { voice, sessions } = await fixture()
    expect(await voice.start()).toBe(true)
    const client = connection()
    client.event({ type: 'transcript', id: 'generated-live-user', role: 'user', text: 'Generated user draft', final: false })
    expect(voice.previewMessages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Generated user draft' })]))
    client.event({ type: 'transcript', id: 'generated-live-user', role: 'user', text: 'Generated user final', final: true })
    client.event({ type: 'transcript', id: 'generated-live-answer', role: 'assistant', text: 'Generated live answer', final: false })
    expect(voice.previewMessages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'assistant', content: 'Generated live answer' })]))
    client.event({ type: 'transcript', id: 'generated-live-answer', role: 'assistant', text: 'Generated final answer', final: true })
    expect(sessions.messages.some(message => message.content === 'Generated final answer')).toBe(false)
    expect(voice.previewMessages).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'Generated final answer' })]))
    client.event({ type: 'audio-done' })
    await vi.waitFor(() => expect(sessions.messages.filter(message => message.content === 'Generated final answer')).toHaveLength(1))
    await vi.waitFor(() => expect(voice.previewMessages).toHaveLength(0))
    voice.stop()
    expect(voice.previewMessages).toHaveLength(0)
  })

  it('aIRI-045 keeps one live voice connection and freezes each transcript recipient while faces change', async () => {
    const { voice, sessions } = await fixture()
    const identity = useStageIdentityStore()
    await identity.setCameraIdentity({ person_id: 'generated-voice-a', display_name: '' }, Date.now() + 10000)
    expect(await voice.start()).toBe(true)
    const client = connection()
    const session = sessions.activeSessionId
    client.event({ type: 'transcript', id: 'generated-a-turn', role: 'user', text: 'Generated A partial', final: false })
    await identity.setCameraIdentity({ person_id: 'generated-voice-b', display_name: 'Generated B' }, Date.now() + 10000)
    client.event({ type: 'transcript', id: 'generated-a-turn', role: 'user', text: 'Generated A final', final: true })
    client.event({ type: 'transcript', id: 'generated-a-answer', role: 'assistant', text: 'Generated answer to A', final: true })
    client.event({ type: 'audio-done' })
    await vi.waitFor(() => expect(sessions.messages.some(message => message.content === 'Generated answer to A')).toBe(true))
    expect(sessions.messages.find(message => message.content === 'Generated A final')?.archive?.personId).toBe('generated-voice-a')
    expect(sessions.messages.find(message => message.content === 'Generated answer to A')?.archive?.personId).toBe('generated-voice-a')
    client.event({ type: 'activity', speaking: false, responding: false })
    expect(await voice.speak('Generated welcome for B')).toBe(true)
    const welcome = client.commands.findLast((command): command is Extract<VoiceCommand, { type: 'speak' }> => command.type === 'speak')!
    completeSpeech(client, welcome)
    await vi.waitFor(() => expect(sessions.messages.some(message => message.content === welcome.text)).toBe(true))
    expect(sessions.messages.find(message => message.content === welcome.text)?.archive?.personId).toBe('generated-voice-b')
    client.event({ type: 'transcript', id: 'generated-b-turn', role: 'user', text: 'Generated B final', final: true })
    await vi.waitFor(() => expect(sessions.messages.some(message => message.content === 'Generated B final')).toBe(true))
    expect(sessions.messages.find(message => message.content === 'Generated B final')?.archive?.personId).toBe('generated-voice-b')
    await identity.setCameraIdentity(null)
    expect(sessions.activeSessionId).toBe(session)
    expect(identity.userId).toBe('local')
    expect(voice.status).toBe('listening')
    expect(boundary.clients.filter(client => client.commands.some(command => command.type === 'start'))).toHaveLength(1)
  })

  // http://127.0.0.1:5174 — AIRI-041: a failed optional draft left the first visitor completely ungreeted.
  it('aIRI-041 welcomes an unknown visitor even when optional greeting preparation fails', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const painting = setInterval(() => canvas.getContext('2d')!.fillRect(0, 0, 320, 240), 50)
    const stream = canvas.captureStream(15)
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(stream)
    cleanups.push(() => {
      clearInterval(painting)
      stream.getTracks().forEach(track => track.stop())
    })
    const { voice, consciousness } = await fixture(false, true)
    const modelFetch = vi.fn<typeof fetch>().mockImplementation(async () => reply('{"not":"spoken text"}'))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    voice.continuationDelaySeconds = 60
    await voice.start()
    const client = connection()
    await vi.waitFor(() => expect(client.commands.some(command => command.type === 'speak')).toBe(true), { timeout: 6500 })
    const speech = client.commands.find((command): command is Extract<VoiceCommand, { type: 'speak' }> => command.type === 'speak')!
    expect(speech.text).toContain('What is your name?')
    expect(modelFetch).toHaveBeenCalledTimes(1)
    const request = JSON.parse(String(modelFetch.mock.calls[0][1]?.body))
    expect(request.messages.at(-1).content).toContain('awaiting_name')
    completeSpeech(client, speech)
    await useCompanionStore().tick()
    expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(1)
  }, 12000)

  it('aIRI-041 routes final spoken introductions and confirmation to the visible face without premature registration', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const painting = setInterval(() => canvas.getContext('2d')!.fillRect(0, 0, 320, 240), 50)
    const stream = canvas.captureStream(15)
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(stream)
    cleanups.push(() => {
      clearInterval(painting)
      stream.getTracks().forEach(track => track.stop())
    })
    const { voice, sessions } = await fixture(false, true)
    const local = useLocalVisionStore()
    await vi.waitFor(() => expect(local.source).toBeDefined(), { timeout: 5000 })
    const learning = { name: '小明', person_id: null, samples: 0, poses: [], learning: true, awaiting_name: false, name_state: 'confirming' }
    await fetch(`/api/local-vision/bindings/${local.source!.session_binding_id}/test-scene`, {
      method: 'POST',
      body: JSON.stringify({ actors: [{ track_id: 'visitor', bbox: [0.1, 0.1, 0.9, 0.9], face_bbox: [0.3, 0.1, 0.5, 0.3], primary: true, identity_status: 'unknown', person_id: null, display_name: null, visible_cues: [] }], turns: [learning, { ...learning, name_state: 'confirmed' }] }),
    })
    await vi.waitFor(() => {
      expect(local.isFresh()).toBe(true)
      expect(local.result?.snapshot.payload.actors[0]?.track_id).toBe('visitor')
    }, { timeout: 5000 })
    expect(await voice.start()).toBe(true)
    const client = connection()
    client.event({ type: 'transcript', id: 'intro', role: 'user', text: '我叫小明', final: true })
    await vi.waitFor(() => expect(local.learning?.name_state).toBe('confirming'))
    expect(local.profile).toBeNull()
    expect(useStageIdentityStore().lease).toBeNull()
    expect(local.project(sessions.activeSessionId)).toContain('Candidate spelling: "小明"')
    await vi.waitFor(() => expect(client.commands.some(command => command.type === 'context' && command.instructions.includes('"name_state":"confirming"'))).toBe(true))
    await vi.waitFor(() => expect(client.commands.some(command => command.type === 'speak' && command.text.includes('Did I write your name correctly'))).toBe(true), { timeout: 3000 })
    const confirmation = client.commands.find((command): command is Extract<VoiceCommand, { type: 'speak' }> => command.type === 'speak' && command.text.includes('Did I write your name correctly'))!
    completeSpeech(client, confirmation)
    client.event({ type: 'transcript', id: 'confirm', role: 'user', text: '名字正确', final: true })
    await vi.waitFor(() => expect(local.learning?.name_state).toBe('confirmed'))
    expect(local.learning?.person_id).toBeNull()
    expect(local.project(sessions.activeSessionId)).toContain('Wait for quality-checked face samples')
    expect(local.project(sessions.activeSessionId)).not.toContain('First confirm the written name.')
    expect(voice.active).toBe(true)
  })

  it('aIRI-041 includes the short speech preference in fast, worker and optional speech requests without constraining pure text', async () => {
    const { voice, consciousness, sessions, container } = await fixture(true)
    const speechField = Array.from(container.querySelectorAll('label')).find(label => label.textContent?.includes('Spoken reply rules'))!.querySelector('textarea')!
    expect(speechField.value).toContain('同时不超过3句话、30个字')
    await userEvent.fill(speechField, 'PUBLIC_SPEECH_RULE：默认同时不超过3句话、30个字，用户要求详细时例外。')
    await userEvent.click(Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Save prompts'))!)
    expect(useBrainPromptsStore().config.speech).toContain('PUBLIC_SPEECH_RULE')
    const modelFetch = vi.fn<typeof fetch>().mockImplementation(async (_input, options) => {
      const request = JSON.parse(String(options?.body))
      return reply(request.messages.at(-1).role === 'system' ? '你好呀，怎么称呼你？' : JSON.stringify({ status: 'completed', result_summary: '已核对，当前记录有效。', suggested_utterance: '已核对。', delivery_policy: 'when_idle' }))
    })
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    expect(await voice.start()).toBe(true)
    const start = connection().commands.find(command => command.type === 'start')!
    expect(start.start.instructions).toContain('同时不超过3句话、30个字')
    expect(start.start.instructions).toContain('PUBLIC_SPEECH_RULE')
    await voice.sendText('核对当前记录', sessions.activeSessionId)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(voice.tasks[0]?.status).toBe('completed'))
    expect(JSON.parse(String(modelFetch.mock.calls[0][1]?.body)).messages[0].content).toContain('同时不超过3句话、30个字')
    expect(JSON.parse(String(modelFetch.mock.calls[0][1]?.body)).messages[0].content).toContain('PUBLIC_SPEECH_RULE')
    voice.stop()
    await voice.sendText('文字核对当前记录', sessions.activeSessionId)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(voice.tasks[0]?.status).toBe('completed'))
    expect(JSON.parse(String(modelFetch.mock.calls[1][1]?.body)).messages[0].content).not.toContain('同时不超过3句话、30个字')
    expect(JSON.parse(String(modelFetch.mock.calls[1][1]?.body)).messages[0].content).not.toContain('PUBLIC_SPEECH_RULE')
    voice.stop()
    await useSlowBrainStore().composeContinuation(sessions.activeSessionId, [], new AbortController().signal, { phase: 'greeting', unanswered_segments: 0, remaining_probe_opportunities: 2 })
    expect(JSON.parse(String(modelFetch.mock.calls[2][1]?.body)).messages[0].content).toContain('同时不超过3句话、30个字')
    expect(JSON.parse(String(modelFetch.mock.calls[2][1]?.body)).messages[0].content).toContain('PUBLIC_SPEECH_RULE')
  })

  it('aIRI-037 sleep closes a live call and rejects late provider audio and manual reconnects', async () => {
    const originalFetch = window.fetch.bind(window)
    vi.spyOn(window, 'fetch').mockImplementation((input, options) => String(input).startsWith('/api/stage-runtime/')
      ? Promise.resolve(Response.json({ vision: 'stopped' }))
      : originalFetch(input, options))
    const { voice } = await fixture(false, true)
    expect(await voice.start()).toBe(true)
    const client = connection()
    await useStageRuntimeStore().close()
    expect(voice.status).toBe('idle')
    expect(voice.tasks).toHaveLength(0)
    client.event({ type: 'audio', speechId: 'public-late-sleep-audio', audio: btoa('\0\0') })
    expect(voice.output).toBeUndefined()
    expect(await voice.start()).toBe(false)
    expect(voice.errorCode).toBe('sleeping')
  })

  // http://127.0.0.1:5174 — AIRI-036: a recovered gateway retained its old unavailable alert.
  // ROOT CAUSE: successful config reads never cleared gateway errors. Clear only the obsolete availability alert.
  it('aIRI-036 clears gateway unavailable after a successful configuration refresh', async () => {
    const { voice } = await fixture()
    boundary.configError = 'gateway'
    expect(await voice.refreshConfig()).toBe(false)
    expect(voice.errorCode).toBe('gateway')
    boundary.configError = ''
    expect(await voice.refreshConfig()).toBe(true)
    expect(voice.available).toBe(true)
    expect(voice.errorCode).toBe('')
  })

  // http://127.0.0.1:5174 — AIRI-036: archive IO must not prevent a configured voice call.
  // ROOT CAUSE: startup awaited all archive IO. Bound that wait and keep read failures separate from audio.
  it('aIRI-036 keeps voice available when optional archive storage fails', async () => {
    const { voice } = await fixture()
    const read = vi.spyOn(storage, 'getKeys').mockRejectedValueOnce(new Error('public-storage-failure'))
    expect(await voice.start()).toBe(true)
    expect(voice.status).toBe('listening')
    expect(read).toHaveBeenCalled()
  })

  it('aIRI-036 connects before a stalled archive read finishes and applies late recall to the same call', async () => {
    const { voice, sessions } = await fixture()
    const previous = await sessions.createSession('default', { setActive: false, messages: [{ id: 'public-delayed', role: 'user', content: 'PUBLIC_DELAYED_ARCHIVE', createdAt: Date.now() - 86400000 }] })
    await useChatArchiveStore().annotate('local', 'default', previous, 'public-delayed', { starred: true, tags: [], note: '', summary: '' })
    const original = storage.getKeys.bind(storage)
    let finish!: () => void
    const read = vi.spyOn(storage, 'getKeys').mockImplementationOnce(async (id) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return original(id)
    })
    const started = voice.start()
    await vi.waitFor(() => expect(read).toHaveBeenCalled())
    await vi.waitFor(() => expect(voice.status).toBe('listening'), { timeout: 1500 })
    expect(await started).toBe(true)
    finish()
    await vi.waitFor(() => expect(connection().commands.some(command => command.type === 'context' && command.instructions.includes('PUBLIC_DELAYED_ARCHIVE'))).toBe(true))
  })

  // http://127.0.0.1:5174 — AIRI-036: speech stops while the same account remains present.
  // ROOT CAUSE: the watcher compared new arrays. Compare ownership values and await account activation before capturing the target.
  it('aIRI-036 preserves an active call across same-person lease and synchronized session refreshes', async () => {
    const { voice, sessions } = await fixture()
    const identity = useStageIdentityStore()
    const person = { person_id: 'public-voice-person', display_name: '测试人物' }
    const seenAt = Date.now()
    await identity.setCameraIdentity(person, Date.now() + 2000)
    expect(await voice.start()).toBe(true)
    expect(sessions.sessionMetas[sessions.activeSessionId]?.userId).toBe(identity.userId)
    await vi.waitFor(() => expect(Date.now() - seenAt).toBeGreaterThanOrEqual(1100), { timeout: 1800 })
    await identity.setCameraIdentity(person, Date.now() + 2000)
    expect(voice.status).toBe('listening')
    // Synced state hydration replaces the generation map even when this call's generation stays equal.
    sessions.applyRemoteSnapshot({ activeSessionId: sessions.activeSessionId, sessionMessages: sessions.sessionMessages, sessionMetas: sessions.sessionMetas })
    expect(voice.status).toBe('listening')
    await identity.setCameraIdentity(null)
    expect(voice.status).toBe('listening')
    await sessions.activateCurrentUser()
  })

  it('aIRI-035 retrieves and annotates prior-session originals through actual model requests with the archive page closed', async () => {
    const { sessions, consciousness, voice } = await fixture()
    const identity = useStageIdentityStore()
    const characterId = useAiriCardStore().activeCardId || 'default'
    const archive = useChatArchiveStore()
    const previous = await sessions.createSession(characterId, { setActive: false, messages: [{ id: 'archive-source', role: 'user', content: 'PUBLIC_ARCHIVE：柔和照明后再核对转头识别。', createdAt: Date.now() - 86400000 }] })
    await archive.annotate(identity.userId, characterId, previous, 'archive-source', { starred: true, tags: [], note: '', summary: 'PUBLIC_RECALL：上次讨论了照明。' })
    const toolReply = (name: string, args: unknown) => new Response([
      `data: ${JSON.stringify({ id: 'archive-tools', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'archive-tools', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
      'data: [DONE]\n\n',
    ].join(''), { headers: { 'Content-Type': 'text/event-stream' } })
    const modelFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(toolReply('search_chat_archive', { query: 'PUBLIC_ARCHIVE', from: null, to: null, limit: 10 }))
      .mockResolvedValueOnce(toolReply('annotate_chat_archive', { session_id: previous, message_id: 'archive-source', starred: true, tags: ['照明'], note: 'PUBLIC_MODEL_NOTE：后续复查', summary: '讨论过照明，原因尚未确认。' }))
      .mockResolvedValueOnce(reply(JSON.stringify({ status: 'completed', result_summary: '找到了上次照明的原话，已加复查备注。', suggested_utterance: '已找到上次的记录。', delivery_policy: 'when_idle' })))
      .mockResolvedValueOnce(reply('普通文字入口也能回顾上次照明的讨论。'))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'archive-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    await voice.start()
    expect(connection().commands.find(command => command.type === 'start')?.start.instructions).toContain('PUBLIC_RECALL')
    const result = await useSlowBrainStore().executor(sessions.activeSessionId)({ task_id: 'archive-task', task_version: 1, objective: '查上次照明的原话并加复查备注', source_turn_id: 'archive-user', status: 'running', delivery: 'pending', accepted_at: Date.now(), progress: { stage: 'working' } }, [], new AbortController().signal)
    expect(result.evidence.some(item => item.source === 'tool:search_chat_archive' && item.summary.includes('PUBLIC_ARCHIVE'))).toBe(true)
    const firstBody = JSON.parse(String(modelFetch.mock.calls[0][1]?.body))
    expect(JSON.stringify(firstBody.messages)).toContain('PUBLIC_RECALL')
    expect(firstBody.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(expect.arrayContaining(['find_chat_partners', 'search_chat_archive', 'read_chat_archive', 'annotate_chat_archive']))
    const followup = JSON.parse(String(modelFetch.mock.calls[1][1]?.body))
    expect(followup.messages.some((message: { role: string, content: string }) => message.role === 'tool' && message.content.includes('PUBLIC_ARCHIVE'))).toBe(true)
    const stored = await archive.query(identity.userId, characterId, { query: 'PUBLIC_MODEL_NOTE' })
    expect(stored.messages[0]).toMatchObject({ text: 'PUBLIC_ARCHIVE：柔和照明后再核对转头识别。', annotation: { author: 'agent' } })
    await useChatStore().send({ sessionId: sessions.activeSessionId, text: '上次聊过什么？' })
    const ordinary = JSON.parse(String(modelFetch.mock.calls[3][1]?.body))
    expect(JSON.stringify(ordinary.messages)).toContain('PUBLIC_MODEL_NOTE')
    expect(ordinary.tools.some((tool: { function: { name: string } }) => tool.function.name === 'search_chat_archive')).toBe(true)
    voice.stop()
  })

  it('saves prompt edits through the UI, persists them and sends them to both actual request boundaries', async () => {
    const { voice, sessions, consciousness, container } = await fixture(true)
    const prompts = useBrainPromptsStore()
    const field = (label: string) => {
      const element = Array.from(container.querySelectorAll('label')).find(item => item.textContent?.includes(label))?.querySelector('textarea')
      if (!element)
        throw new Error(`Missing prompt field: ${label}`)
      return element
    }
    await userEvent.fill(field('Fast brain work prompt'), 'PUBLIC_FAST_RULE：按我的快脑风格说话。')
    await userEvent.fill(field('Slow brain task prompt'), 'PUBLIC_SLOW_RULE：认真核对公开资料。')
    expect(prompts.config.fast).not.toContain('PUBLIC_FAST_RULE')
    const save = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Save prompts'))!
    await userEvent.click(save)
    await vi.waitFor(() => expect(container.textContent).toContain('Saved for the next task or call.'))
    await vi.waitFor(() => expect(localStorage.getItem('settings/realtime-voice/brain-prompts')).toContain('PUBLIC_SLOW_RULE'))

    const modelFetch = vi.fn<typeof fetch>(async () => reply(JSON.stringify({ status: 'completed', result_summary: '公开测试核对完成。', suggested_utterance: '核对完成。', delivery_policy: 'when_idle' })))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    await voice.sendText('核对公开测试资料', sessions.activeSessionId)
    await vi.waitFor(() => expect(voice.tasks[0]?.delivery).toBe('delivered'))
    const body = JSON.parse(String(modelFetch.mock.calls[0][1]?.body))
    expect(body.messages[0].content).toContain('PUBLIC_SLOW_RULE')
    expect(body.messages[0].content).toContain('只返回JSON')
    expect(body.messages[0].content).toContain('result_summary')
    voice.stop()
    await voice.start()
    expect(connection().commands.find(command => command.type === 'start')?.start.instructions).toContain('PUBLIC_FAST_RULE')
    expect(connection().commands.find(command => command.type === 'start')?.start.instructions).not.toContain('PUBLIC_SLOW_RULE')
    const reopenedPinia = createPinia()
    cleanups.push(() => disposePinia(reopenedPinia))
    expect(useBrainPromptsStore(reopenedPinia).config.fast).toContain('PUBLIC_FAST_RULE')
  })

  it('rejects invalid prompt drafts and restores defaults only after saving', async () => {
    const { container } = await fixture(true)
    const prompts = useBrainPromptsStore()
    prompts.save({ ...prompts.config, fast: 'PUBLIC_CUSTOM_RULE' })
    await vi.waitFor(() => expect(container.querySelector('textarea')?.value).toContain('PUBLIC_CUSTOM_RULE'))
    await userEvent.fill(container.querySelector('textarea')!, '')
    const save = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Save prompts'))!
    expect(save.disabled).toBe(true)
    expect(prompts.config.fast).toBe('PUBLIC_CUSTOM_RULE')
    const restore = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Restore defaults to draft'))!
    await userEvent.click(restore)
    expect(prompts.config.fast).toBe('PUBLIC_CUSTOM_RULE')
    await userEvent.click(save)
    await vi.waitFor(() => expect(prompts.config.fast).not.toContain('PUBLIC_CUSTOM_RULE'))
    expect(() => prompts.save({ ...prompts.config, fast: 'x'.repeat(2501) })).toThrow()
    expect(prompts.config.fast.length).toBeLessThanOrEqual(2500)
  })

  it('applies custom continuation and style rules and blocks a draft prepared before a saved revision', async () => {
    const { voice, consciousness } = await fixture()
    const prompts = useBrainPromptsStore()
    prompts.save({ ...prompts.config, continuation: 'PUBLIC_CONTINUATION_RULE', styles: { ...prompts.config.styles, chatty: 'PUBLIC_CHATTY_RULE' } })
    let finish!: (response: Response) => void
    const modelFetch = vi.fn<typeof fetch>(() => new Promise(resolve => finish = resolve))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    vi.useFakeTimers()
    await voice.start()
    const client = connection()
    expect(client.commands.find(command => command.type === 'start')?.start.instructions).toContain('PUBLIC_CHATTY_RULE')
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledOnce())
    const body = JSON.parse(String(modelFetch.mock.calls[0][1]?.body))
    expect(body.messages[0].content).toContain('PUBLIC_CONTINUATION_RULE')
    expect(body.messages[0].content).toContain('PUBLIC_CHATTY_RULE')
    prompts.save({ ...prompts.config, continuation: 'PUBLIC_NEW_CONTINUATION_RULE' })
    expect(voice.active).toBe(false)
    finish(reply('旧提示词准备的片段。'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(0)
  })

  // http://127.0.0.1:5174 — AIRI-032: active mode leaves the configured realtime call idle with ordinary input enabled.
  // ROOT CAUSE: maintainVoice rejected enabled ordinary input, although the page already pauses its ASR consumer during realtime calls.
  // Remove that gate. Keep one call per encounter, explicit mode restart, and passive-mode cleanup.
  it.each([false, true])('aIRI-032 / AIRI-043 starts one encounter call with ordinary microphone enabled=%s and keeps group presence', async (inputEnabled) => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const context = canvas.getContext('2d')!
    const microphoneContext = new AudioContext()
    const streams: MediaStream[] = []
    const painting = setInterval(() => context.fillRect(0, 0, 320, 240), 50)
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(async (constraints) => {
      const stream = constraints?.video ? canvas.captureStream(15) : microphoneContext.createMediaStreamDestination().stream
      streams.push(stream)
      return stream
    })
    cleanups.push(() => {
      clearInterval(painting)
      streams.forEach(stream => stream.getTracks().forEach(track => track.stop()))
      void microphoneContext.close()
    })
    const { voice, container } = await fixture(false, true)
    const local = useLocalVisionStore()
    const companion = useCompanionStore()
    const devices = useSettingsAudioDevice()
    const speech = useSpeechRuntimeStore()
    local.setMode('passive')
    const pipeline = createSpeechPipeline<AudioBuffer>({
      tts: async () => null,
      playback: createPlaybackManager<AudioBuffer>({ play: async () => {} }),
    })
    await speech.registerHost(pipeline)
    cleanups.push(() => {
      void speech.dispose()
    })
    devices.enabled = inputEnabled
    if (inputEnabled)
      await vi.waitFor(() => expect(devices.stream?.getAudioTracks()[0]?.readyState).toBe('live'))

    await userEvent.click(container.querySelector('aside button[aria-pressed="false"]')!)
    expect(local.mode).toBe('active')
    await vi.waitFor(() => expect(voice.status).toBe('listening'), { timeout: 5000 })
    expect(voice.mode).toBe('voice')
    expect(devices.enabled).toBe(inputEnabled)
    expect(connection().commands.filter(command => command.type === 'start')).toHaveLength(1)

    // AIRI-043: presence remains valid when a second stranger joins and the primary track changes.
    const identityBeforeGroup = useStageIdentityStore().userId
    const sessionBeforeGroup = useChatSessionStore().activeSessionId
    const originalNow = performance.now.bind(performance)
    let clockOffset = 0
    vi.spyOn(performance, 'now').mockImplementation(() => originalNow() + clockOffset)
    const sourceBeforeGroup = local.source!.session_binding_id
    const firstActor = local.result!.snapshot.payload.actors[0]
    const secondActor = { ...firstActor, track_id: firstActor.track_id + 1, primary: true }
    await fetch(`/api/local-vision/bindings/${sourceBeforeGroup}/test-scene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actors: [{ ...firstActor, primary: false }, secondActor] }),
    })
    await vi.waitFor(() => expect(local.result?.snapshot.payload.actors).toHaveLength(2), { timeout: 2500 })
    for (let step = 0; step < 7; step++) {
      const sequence = local.result!.snapshot.payload.frame_seq
      clockOffset += 5000
      await vi.waitFor(() => expect(local.result!.snapshot.payload.frame_seq).toBeGreaterThan(sequence), { timeout: 2500 })
      await companion.tick()
    }
    expect(voice.status).toBe('listening')
    expect(useStageIdentityStore().userId).toBe(identityBeforeGroup)
    expect(useChatSessionStore().activeSessionId).toBe(sessionBeforeGroup)
    await fetch(`/api/local-vision/bindings/${sourceBeforeGroup}/test-scene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actors: [firstActor] }),
    })
    await vi.waitFor(() => expect(local.result?.snapshot.payload.actors).toHaveLength(1), { timeout: 2500 })

    voice.stop()
    await companion.tick()
    await companion.tick()
    expect(voice.active).toBe(false)
    expect(boundary.clients.filter(client => client.commands.some(command => command.type === 'start'))).toHaveLength(1)

    local.setMode('passive')
    local.setMode('active')
    await vi.waitFor(() => expect(voice.status).toBe('listening'), { timeout: 5000 })
    expect(boundary.clients.filter(client => client.commands.some(command => command.type === 'start'))).toHaveLength(2)
    const source = local.source!.session_binding_id
    await fetch(`/api/local-vision/bindings/${source}/test-scene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actors: [{ ...local.result!.snapshot.payload.actors[0], identity_status: 'confirmed', person_id: 'generated-account', display_name: '测试账户' }] }),
    })
    const identity = useStageIdentityStore()
    await vi.waitFor(() => expect(identity.archiveUserId).toBe('local-face:generated-account'), { timeout: 2500 })
    expect(identity.userId).toBe('local')
    expect(boundary.clients.filter(client => client.commands.some(command => command.type === 'start'))).toHaveLength(2)
    expect(voice.status).toBe('listening')
    await vi.waitFor(() => expect(connection().commands.some(command => command.type === 'context' && command.instructions.includes('测试账户'))).toBe(true))
    expect(useChatSessionStore().sessionMetas[useChatSessionStore().activeSessionId]?.userId).toBe(identity.userId)
    expect(local.source!.session_binding_id).toBe(source)
    local.setMode('passive')
    expect(voice.active).toBe(false)
  }, 25000)

  // http://127.0.0.1:5174 — AIRI-028: visual identity refreshes restart the last seconds of the idle countdown.
  // ROOT CAUSE: a timer captures no private data. Only the draft and automatic speech require visual-scope invalidation.
  it('aIRI-028 keeps the idle deadline across camera scope changes before any draft exists', async () => {
    const { voice, consciousness } = await fixture()
    let scope = 'public-camera-candidate'
    cleanups.push(registerLocalVisionContext({ project: () => 'Public observation', scope: () => scope }))
    const modelFetch = vi.fn<typeof fetch>().mockImplementation(async () => reply('一个公开测试的话题。'))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    voice.continuationDelaySeconds = 10
    vi.useFakeTimers()
    await voice.start()
    const deadline = voice.continuationScheduledAt
    await vi.advanceTimersByTimeAsync(5000)
    scope = 'public-camera-confirmed'
    await voice.updateVisualContext()
    expect(voice.continuationScheduledAt).toBe(deadline)
    await vi.advanceTimersByTimeAsync(5000)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledTimes(1))
    expect(connection().commands.some(command => command.type === 'speak')).toBe(true)
  })

  // http://127.0.0.1:5174 — AIRI-028: an active chatty call suppresses the camera's first greeting.
  // ROOT CAUSE: the camera skipped all candidates. Its initial welcome now reserves the same model and speech owner.
  it('aIRI-028 greets a camera visitor through the same chatty speech owner once', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const context = canvas.getContext('2d')!
    const stream = canvas.captureStream(15)
    const painting = setInterval(() => {
      context.fillRect(0, 0, 320, 240)
    }, 50)
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(stream)
    cleanups.push(() => {
      clearInterval(painting)
      stream.getTracks().forEach(track => track.stop())
    })
    const { voice, consciousness, sessions } = await fixture(false, true)
    const modelFetch = vi.fn<typeof fetch>().mockImplementation(async () => reply('你好呀，我正好想到一个有趣的小点子。'))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    voice.continuationDelaySeconds = 10
    await voice.start()
    const local = useLocalVisionStore()
    await vi.waitFor(() => expect(local.greeting?.text).toContain('你好呀'), { timeout: 6500 })
    const speeches = connection().commands.filter((command): command is Extract<VoiceCommand, { type: 'speak' }> => command.type === 'speak')
    expect(speeches).toHaveLength(1)
    expect(modelFetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(modelFetch.mock.calls[0][1]?.body)).messages.at(-1).content).toContain('greeting')
    expect(sessions.messages.some(message => message.content === speeches[0].text)).toBe(false)
    completeSpeech(connection(), speeches[0])
    await vi.waitFor(() => expect(sessions.messages.filter(message => message.content === speeches[0].text)).toHaveLength(1))
    expect(voice.continuationContext.phase).toBe('opening')
  }, 15000)

  it('aIRI-028 revokes prepared greeting audio when visual identity permission changes', async () => {
    const { voice, consciousness, sessions } = await fixture()
    let scope = 'public-visitor-a'
    cleanups.push(registerLocalVisionContext({ project: () => 'Public visitor', scope: () => scope }))
    const modelFetch = vi.fn<typeof fetch>().mockImplementation(async () => reply('你好呀，公开测试的朋友。'))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    await voice.start()
    await voice.greet()
    const narration = connection().commands.find((command): command is Extract<VoiceCommand, { type: 'speak' }> => command.type === 'speak')!
    scope = 'public-permission-revoked'
    await voice.updateVisualContext()
    expect(connection().commands.some(command => command.type === 'cancel')).toBe(true)
    completeSpeech(connection(), narration)
    expect(sessions.messages.some(message => message.content === narration.text)).toBe(false)
    expect(voice.continuationContext.unanswered_segments).toBe(0)
  })

  it('aIRI-027 persists the UI delay and applies five and ten seconds to a live call', async () => {
    const { voice, consciousness, container } = await fixture(true)
    const modelFetch = vi.fn<typeof fetch>().mockImplementation(async () => reply('一个公开测试的小点子，先挑一盏温暖的灯。'))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    await vi.waitFor(() => expect([...container.querySelectorAll('button')].some(button => button.textContent?.trim() === '5 seconds')).toBe(true))
    await userEvent.click([...container.querySelectorAll('button')].find(button => button.textContent?.trim() === '5 seconds')!)
    expect(voice.continuationDelaySeconds).toBe(5)
    expect(localStorage.getItem('settings/realtime-voice/continuation-delay-seconds')).toBe('5')
    vi.useFakeTimers()
    await voice.start()
    const client = connection()
    expect(voice.continuationStatus).toBe('waiting')
    await vi.advanceTimersByTimeAsync(4900)
    expect(modelFetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(1))
    expect(voice.continuationStatus).toBe('waitingForSpeech')
    completeSpeech(client, client.commands.findLast(command => command.type === 'speak')!)
    await userEvent.click([...container.querySelectorAll('button')].find(button => button.textContent?.trim() === '10 seconds')!)
    expect(voice.continuationDelaySeconds).toBe(10)
    expect(localStorage.getItem('settings/realtime-voice/continuation-delay-seconds')).toBe('10')
    await vi.advanceTimersByTimeAsync(9900)
    expect(modelFetch).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(200)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledTimes(2))
    client.event({ type: 'interrupt' })
    client.event({ type: 'activity', speaking: true, responding: false })
    expect(voice.continuationStatus).toBe('waitingForUser')
    await vi.advanceTimersByTimeAsync(15000)
    expect(modelFetch).toHaveBeenCalledTimes(2)
  })

  it('aIRI-027 counts heard segments for reflection and topic changes, and resets on real user input', async () => {
    const { voice, consciousness } = await fixture()
    const modelFetch = vi.fn<typeof fetch>().mockImplementation(async () => reply(`公开测试片段 ${modelFetch.mock.calls.length}，留一个轻松的停顿。`))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    vi.useFakeTimers()
    await voice.start()
    const client = connection()
    for (const [index, phase] of ['opening', 'gentle_probe', 'gentle_probe', 'change_topic', 'develop_topic'].entries()) {
      await vi.advanceTimersByTimeAsync(2100)
      await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(index + 1))
      const body = JSON.parse(String(modelFetch.mock.calls[index][1]?.body))
      expect(body.messages[1].content).toContain(`"phase":"${phase}"`)
      expect(body.messages[1].content).toContain(`"unanswered_segments":${index}`)
      const narration = client.commands.findLast(command => command.type === 'speak')!
      client.event({ type: 'audio', speechId: narration.id, audio: btoa('\0\0') })
      client.event({ type: 'transcript', id: narration.id, role: 'assistant', text: narration.text, final: true })
      client.event({ type: 'audio-done', speechId: narration.id })
      expect(voice.continuationContext.unanswered_segments).toBe(index)
      boundary.playback.at(-1)!.end()
      expect(voice.continuationContext.unanswered_segments).toBe(index + 1)
    }
    const first = JSON.parse(String(modelFetch.mock.calls[0][1]?.body))
    expect(first.messages[0].content).toContain('私下考虑措辞是否冒犯')
    expect(first.messages[0].content).toContain('不索取安慰')
    client.event({ type: 'activity', speaking: true, responding: false })
    client.event({ type: 'transcript', id: 'new-topic-user', role: 'user', text: '我想聊花园', final: true })
    client.event({ type: 'activity', speaking: false, responding: false })
    expect(voice.continuationContext.unanswered_segments).toBe(0)
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(6))
    const next = JSON.parse(String(modelFetch.mock.calls[5][1]?.body))
    expect(next.messages[1].content).toContain('我想聊花园')
    expect(next.messages[1].content).toContain('"phase":"gentle_probe"')
    voice.interrupt()
    expect(voice.continuationContext.unanswered_segments).toBe(0)
    voice.resumeDelivery()
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledTimes(7))
    expect(JSON.parse(String(modelFetch.mock.calls[6][1]?.body)).messages[1].content).toContain('"remaining_probe_opportunities":2')
  })

  it('aIRI-027 aborts drafts on encounter changes even when observations remain nonempty', async () => {
    const { voice, consciousness } = await fixture()
    let scope = 'public-person-a'
    cleanups.push(registerLocalVisionContext({ project: () => 'Public environment', scope: () => scope }))
    const finishes: Array<(response: Response) => void> = []
    const modelFetch = vi.fn<typeof fetch>(() => new Promise(resolve => finishes.push(resolve)))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    vi.useFakeTimers()
    await voice.start()
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledOnce())
    scope = 'public-person-b'
    await voice.updateVisualContext()
    expect(modelFetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    finishes[0](reply('旧人物范围中的稿件'))
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledTimes(2))
    expect(connection().commands.filter(command => command.type === 'speak')).toHaveLength(0)
    expect(voice.continuationError).toBe(false)
  })

  // http://127.0.0.1:5174 — AIRI-027: camera observations refresh while a continuation request is running.
  // ROOT CAUSE: frame text equality cancelled drafts and rejected results. Permission and encounter scopes now govern invalidation.
  it('aIRI-027 lets ordinary camera refreshes finish the same automatic draft', async () => {
    const { voice, consciousness } = await fixture()
    let visualContext = 'Public observation at 10:00:00'
    cleanups.push(registerLocalVisionContext({ project: () => visualContext, scope: () => 'public-test-scope' }))
    let finish!: (response: Response) => void
    const modelFetch = vi.fn<typeof fetch>(() => new Promise(resolve => finish = resolve))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    vi.useFakeTimers()
    await voice.start()
    const client = connection()
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledOnce())
    visualContext = 'Public observation at 10:00:03'
    await voice.updateVisualContext()
    expect(modelFetch.mock.calls[0][1]?.signal?.aborted).toBe(false)
    finish(reply('我想到一个小计划，给普通的文件夹起个有趣的名字。'))
    await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(1))
    expect(voice.continuationError).toBe(false)
    expect(voice.continuationRequests).toBe(1)
  })

  // http://127.0.0.1:5174 — AIRI-026: expanded character guidance must fit the real context command limit.
  it('aIRI-026 bounds live context while preserving valid task and fact JSON', async () => {
    const { voice, consciousness } = await fixture()
    const cards = useAiriCardStore()
    await cards.initialize()
    await cards.updateCard(cards.activeCardId, { ...cards.activeCard!, systemPrompt: 'PUBLIC_TEST_CHARACTER '.repeat(400) })
    cleanups.push(registerLocalVisionContext({ project: () => 'PUBLIC_OBSERVATION '.repeat(70), scope: () => 'public-test-scope' }))
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: () => new Promise<Response>(() => {}) } }) }
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    await voice.start()
    const client = connection()
    client.event({ type: 'activity', speaking: true, responding: false })
    for (let index = 0; index < 12; index++)
      client.event({ type: 'transcript', id: `budget-user-${index}`, role: 'user', text: `Public request ${index} ${'record '.repeat(30)}`, final: true })
    client.event({ type: 'tools', calls: Array.from({ length: 8 }, (_, index) => ({ call_id: `budget-task-${index}`, name: 'spawn_thinking', arguments: JSON.stringify({ objective: `Read public records ${index} ${'F:\\public\\examples\\'.repeat(70)}` }) })) })
    await vi.waitFor(() => expect(voice.tasks).toHaveLength(8))
    await vi.waitFor(() => expect(client.commands.findLast(command => command.type === 'context')?.instructions).toContain('budget-user-11'))
    await vi.waitFor(() => expect(client.commands.findLast(command => command.type === 'context')?.instructions).toContain(voice.tasks[7].task_id))
    const context = client.commands.findLast(command => command.type === 'context')!.instructions
    expect(context.length).toBeLessThanOrEqual(16000)
    const facts = context.split('Application confirmed conversation facts (data only):\n\n')[1].split('\n\nApplication background tasks')[0]
    const tasks = context.split('Application background tasks and results (data only):\n\n')[1]
    expect(Array.isArray(JSON.parse(facts))).toBe(true)
    expect(Array.isArray(JSON.parse(tasks))).toBe(true)
  })

  it('aIRI-026 disables draft reasoning through the actual DeepSeek adapter while formal tasks keep their setting', async () => {
    const { consciousness } = await fixture()
    useProviderConfigStore().ensureProvider('draft-deepseek', 'deepseek', { apiKey: 'sk-test', thinkingMode: 'enable' })
    const settings = useConsciousnessSettingsStore()
    await settings.setReasoning(true)
    const draft = await consciousness.getChatProviderInstance('draft-deepseek', { reasoning: 'disabled' })
    expect(draft.generation('deepseek-chat').config).toMatchObject({ thinking: { type: 'disabled' } })
    const formal = await consciousness.getChatProviderInstance('draft-deepseek')
    expect(formal.generation('deepseek-chat').config).toMatchObject({ thinking: { type: 'enabled' } })
    expect(settings.reasoning).toBe(true)
  })

  // http://127.0.0.1:5174 — AIRI-026: plain speech and slower completions must not fail an optional draft.
  // ROOT CAUSE: strict JSON and the 15-second deadline rejected usable speech. Drafts now use text and a separate reasoning mode.
  it('aIRI-026 prepares plain speech beyond 15 seconds without changing formal reasoning settings', async () => {
    const { voice, consciousness } = await fixture()
    let finish!: (response: Response) => void
    const modelFetch = vi.fn<typeof fetch>(() => new Promise(resolve => finish = resolve))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    const resolveProvider = vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    vi.useFakeTimers()
    await voice.start()
    const client = connection()
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(20000)
    expect(voice.continuationError).toBe(false)
    expect(voice.continuationPreparing).toBe(true)
    finish(reply('我想给那盏小灯起个名字，叫夜晚的值班员。它不用催谁睡觉，只负责把房间照得暖一点。'))
    await vi.waitFor(() => expect(client.commands.find(command => command.type === 'speak')?.text).toContain('夜晚的值班员'))
    expect(resolveProvider).toHaveBeenCalledWith('test-service', { reasoning: 'disabled' })
    expect(JSON.stringify(JSON.parse(String(modelFetch.mock.calls[0][1]?.body)).messages)).toContain('只返回400字以内的中文口语')
    expect(voice.continuationRequests).toBe(1)
  })

  // http://127.0.0.1:5174 — AIRI-026: the original boolean concealed authentication and service errors.
  // ROOT CAUSE: the catch discarded all diagnostics. A safe boundary preserves HTTP status without provider response bodies.
  it('aIRI-026 shows the real HTTP status without exposing a provider error body', async () => {
    const { voice, consciousness, container } = await fixture()
    const modelFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('PRIVATE_PROVIDER_BODY', { status: 401 }))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    vi.useFakeTimers()
    await voice.start()
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(voice.continuationError).toBe(true))
    expect(container.textContent).toContain('HTTP 401')
    expect(container.textContent).not.toContain('PRIVATE_PROVIDER_BODY')
    expect(voice.active).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(modelFetch).toHaveBeenCalledOnce()
  })

  // http://127.0.0.1:5174 — AIRI-026: application templates bypassed the character prompt.
  // ROOT CAUSE: random locale phrases replaced model wording. The task receipt now queues the model-authored phrases once.
  it('aIRI-026 reads the fast model acknowledgement once and lets the completed result take priority', async () => {
    const { voice, consciousness } = await fixture()
    const cards = useAiriCardStore()
    await cards.initialize()
    await cards.updateCard(cards.activeCardId, { ...cards.activeCard!, systemPrompt: 'PUBLIC_TEST_CHARACTER: Speak warmly, keep a calm pace, and share specific observations.' })
    let finish!: (response: Response) => void
    const modelFetch = vi.fn<typeof fetch>(() => new Promise(resolve => finish = resolve))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    vi.useFakeTimers()
    await voice.start()
    const client = connection()
    client.event({ type: 'transcript', id: 'persona-user', role: 'user', text: '帮我核对记录', final: true })
    const argumentsText = JSON.stringify({ objective: '核对记录', acknowledgement: '好呀，我把这条记录仔细对一对，有结果就来告诉你。', waiting_utterance: '还在处理这件事，我有结果就告诉你。' })
    client.event({ type: 'tools', calls: [{ call_id: 'persona-work', name: 'spawn_thinking', arguments: argumentsText }] })
    await vi.advanceTimersByTimeAsync(250)
    const accepted = client.commands.find(command => command.type === 'speak')!
    expect(accepted.text).toBe('好呀，我把这条记录仔细对一对，有结果就来告诉你。')
    completeSpeech(client, accepted)
    client.event({ type: 'tools', calls: [{ call_id: 'persona-repeat', name: 'spawn_thinking', arguments: argumentsText }] })
    await vi.advanceTimersByTimeAsync(15000)
    const waiting = client.commands.findLast(command => command.type === 'speak')!
    expect(waiting.text).toBe('还在处理这件事，我有结果就告诉你。')
    completeSpeech(client, waiting)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledOnce())
    finish(reply(JSON.stringify({ status: 'completed', result_summary: '这条测试记录已经核对好了。', suggested_utterance: '记录核对好了。', delivery_policy: 'when_idle' })))
    await vi.waitFor(() => expect(voice.tasks[0]?.status).toBe('completed'))
    await vi.advanceTimersByTimeAsync(800)
    expect(client.commands.findLast(command => command.type === 'speak')?.text).toBe('这条测试记录已经核对好了。')
    expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(3)
    expect(client.commands.find(command => command.type === 'start')?.start.instructions).toContain('acknowledgement')
    expect(client.commands.find(command => command.type === 'start')?.start.instructions).toContain('PUBLIC_TEST_CHARACTER')
    expect(JSON.stringify(JSON.parse(String(modelFetch.mock.calls[0][1]?.body)).messages)).toContain('PUBLIC_TEST_CHARACTER')
  })

  // http://127.0.0.1:5174 — AIRI-024: automatic continuation cannot impersonate a user turn.
  // ROOT CAUSE: core projects context authority as a user message. Host continuation data uses a system envelope instead.
  it('aIRI-024 continues without user messages and shares only confirmed speech with the next draft', async () => {
    const { voice, consciousness, sessions } = await fixture()
    const modelFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply('我想给闹钟起个名字：早晨交响队，准时上班，声势很大。'))
      .mockResolvedValueOnce(reply('不过它还缺一项功能：响完认真道歉。我会先给它设计一个礼貌按钮。'))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    vi.useFakeTimers()
    await voice.start()
    const client = connection()
    expect(voice.deliveryPaused).toBe(false)
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(1))
    const first = client.commands.find(command => command.type === 'speak')!
    expect(sessions.messages.some(message => message.content === first.text)).toBe(false)
    const body = JSON.parse(String(modelFetch.mock.calls[0][1]?.body))
    expect(body.messages.every((message: { role: string }) => message.role === 'system')).toBe(true)
    expect(body.tools).toBeUndefined()
    expect(JSON.stringify(body.messages)).toContain('没有新的用户消息')
    expect(JSON.stringify(body.messages)).toContain('当前人物')
    await vi.advanceTimersByTimeAsync(3000)
    expect(modelFetch).toHaveBeenCalledOnce()
    completeSpeech(client, first)
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(2))
    expect(JSON.parse(String(modelFetch.mock.calls[1][1]?.body)).messages[1].content).toContain(first.text)
    expect(sessions.messages.filter(message => message.role === 'user')).toHaveLength(0)
    expect(voice.continuationRequests).toBe(2)
  })

  it('aIRI-024 discards a late draft after user speech and follows the actual new turn', async () => {
    const { voice, consciousness } = await fixture()
    let finish!: (response: Response) => void
    const modelFetch = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise(resolve => finish = resolve))
      .mockResolvedValueOnce(reply('那我顺着你刚才说的花园聊，我想象的第一步是选一盏温暖的小灯。'))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    vi.useFakeTimers()
    await voice.start()
    const client = connection()
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledOnce())
    client.event({ type: 'activity', speaking: true, responding: false })
    expect(modelFetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    client.event({ type: 'transcript', id: 'garden-user', role: 'user', text: '我更想聊花园', final: true })
    finish(reply('旧话题的迟到片段'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(client.commands.some(command => command.type === 'speak')).toBe(false)
    client.event({ type: 'activity', speaking: false, responding: false })
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(client.commands.some(command => command.type === 'speak')).toBe(true))
    expect(JSON.stringify(JSON.parse(String(modelFetch.mock.calls[1][1]?.body)).messages)).toContain('我更想聊花园')
    expect(client.commands.some(command => command.type === 'speak' && command.text === '旧话题的迟到片段')).toBe(false)
  })

  // http://127.0.0.1:5174 — AIRI-024: paused UI also claimed automatic continuation remained active.
  // ROOT CAUSE: the status projection ignored deliveryPaused. Render one paused status with the request count.
  it('aIRI-024 pauses from the UI and model control, and mode changes discard unfinished drafts', async () => {
    const { voice, consciousness, container } = await fixture()
    let finish!: (response: Response) => void
    const modelFetch = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => finish = resolve))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    await voice.start()
    await userEvent.click([...container.querySelectorAll('button')].find(button => button.textContent?.includes('Pause automatic speech'))!)
    expect(container.textContent).not.toContain('Continues during voice pauses')
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(3000)
    expect(modelFetch).not.toHaveBeenCalled()
    const client = connection()
    client.event({ type: 'tools', calls: [{ call_id: 'chatty-resume', name: 'set_agent_delivery', arguments: '{"mode":"automatic"}' }] })
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledOnce())
    voice.conversationStyle = 'listening'
    expect(modelFetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    finish(reply('不应播出的旧片段'))
    await vi.advanceTimersByTimeAsync(4000)
    expect(client.commands.some(command => command.type === 'speak')).toBe(false)
    expect(voice.active).toBe(true)
  })

  it('aIRI-024 gives formal tasks priority over continuation and resumes after confirmed delivery', async () => {
    const { voice, consciousness } = await fixture()
    let finish!: (response: Response) => void
    const modelFetch = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise(resolve => finish = resolve))
      .mockResolvedValueOnce(reply(JSON.stringify({ status: 'completed', result_summary: '只有测试记录已验证。', suggested_utterance: '记录好了。', delivery_policy: 'when_idle' })))
      .mockResolvedValueOnce(reply('事情核对完了，我又想到一个小点子：给文件夹起一个更容易找到的名字。'))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    vi.useFakeTimers()
    await voice.start()
    const client = connection()
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledOnce())
    client.event({ type: 'transcript', id: 'task-user', role: 'user', text: '先帮我核对记录', final: true })
    client.event({ type: 'tools', calls: [{ call_id: 'chatty-task', name: 'spawn_thinking', arguments: '{"objective":"核对记录","waiting_utterance":"Background work is still running. I\'ll tell you when a confirmed result is ready."}' }] })
    finish(reply('作废的闲聊内容'))
    await vi.waitFor(() => expect(voice.tasks[0]?.status).toBe('completed'))
    await vi.advanceTimersByTimeAsync(800)
    const result = client.commands.findLast(command => command.type === 'speak')!
    expect(result.text).toBe('只有测试记录已验证。')
    await vi.advanceTimersByTimeAsync(5000)
    expect(modelFetch).toHaveBeenCalledTimes(2)
    completeSpeech(client, result)
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledTimes(3))
    expect(client.commands.some(command => command.type === 'speak' && command.text === '作废的闲聊内容')).toBe(false)
  })

  it('aIRI-024 suspends failed drafts, retries explicitly, and bounds automatic requests per call', async () => {
    const { voice, consciousness, container } = await fixture()
    const modelFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply(''))
      .mockImplementation(async () => reply(`公开测试片段 ${modelFetch.mock.calls.length}，我会留一个自然的停顿。`))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    vi.useFakeTimers()
    await voice.start()
    const client = connection()
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(voice.continuationError).toBe(true))
    expect(container.textContent).toContain('Automatic requests suspended')
    await vi.advanceTimersByTimeAsync(5000)
    expect(modelFetch).toHaveBeenCalledOnce()
    expect(voice.active).toBe(true)
    voice.resumeDelivery()
    for (let count = 2; count <= voice.continuationLimit; count++) {
      await vi.advanceTimersByTimeAsync(2100)
      await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledTimes(count))
      await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(count - 1))
      completeSpeech(client, client.commands.findLast(command => command.type === 'speak')!)
    }
    await vi.advanceTimersByTimeAsync(5000)
    expect(modelFetch).toHaveBeenCalledTimes(30)
    expect(container.textContent).toContain('reached this call\'s limit')
    voice.resumeDelivery()
    await vi.advanceTimersByTimeAsync(5000)
    expect(modelFetch).toHaveBeenCalledTimes(30)
    voice.stop()
    expect(voice.continuationRequests).toBe(0)
  })

  it('aIRI-024 keeps automatic continuation off without a model and in text mode', async () => {
    const { voice, consciousness, container } = await fixture()
    voice.conversationStyle = 'chatty'
    vi.useFakeTimers()
    await voice.start()
    await vi.advanceTimersByTimeAsync(4000)
    expect(voice.continuationRequests).toBe(0)
    expect(container.textContent).toContain('Select a background model for automatic continuation')
    voice.stop()
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    await voice.start('text')
    await vi.advanceTimersByTimeAsync(4000)
    expect(voice.continuationRequests).toBe(0)
    expect(container.textContent).toContain('Automatic continuation requires a voice call')
  })

  it('aIRI-024 times out preparation without ending the call and rejects output after hangup', async () => {
    const { voice, consciousness } = await fixture()
    const finishes: Array<(response: Response) => void> = []
    const modelFetch = vi.fn<typeof fetch>(() => new Promise(resolve => finishes.push(resolve)))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    vi.useFakeTimers()
    await voice.start()
    const client = connection()
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(45000)
    expect(voice.continuationError).toBe(true)
    expect(voice.continuationPreparing).toBe(false)
    expect(voice.active).toBe(true)
    expect(modelFetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    finishes[0](reply('超时的片段'))
    voice.resumeDelivery()
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledTimes(2))
    voice.stop()
    expect(modelFetch.mock.calls[1][1]?.signal?.aborted).toBe(true)
    finishes[1](reply('挂断后的片段'))
    await vi.advanceTimersByTimeAsync(4000)
    expect(client.commands.some(command => command.type === 'speak')).toBe(false)
  })

  it('aIRI-024 invalidates drafts when the configured model changes during a call', async () => {
    const { voice, consciousness } = await fixture()
    let finish!: (response: Response) => void
    const modelFetch = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise(resolve => finish = resolve))
      .mockResolvedValueOnce(reply('这是新模型准备的公开测试片段。'))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    vi.useFakeTimers()
    await voice.start()
    const client = connection()
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledOnce())
    consciousness.activeModel = 'new-model'
    expect(modelFetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    finish(reply('旧模型作废片段'))
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(1))
    expect(JSON.parse(String(modelFetch.mock.calls[1][1]?.body)).model).toBe('new-model')
    expect(client.commands.find(command => command.type === 'speak')?.text).toBe('这是新模型准备的公开测试片段。')
  })

  it('aIRI-024 discards a draft after authorized visual context is withdrawn', async () => {
    const { voice, consciousness } = await fixture()
    let visualContext = 'PUBLIC_TEST_OBSERVATION'
    cleanups.push(registerLocalVisionContext({ project: () => visualContext, scope: () => 'public-test-scope' }))
    let finish!: (response: Response) => void
    const modelFetch = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise(resolve => finish = resolve))
      .mockResolvedValueOnce(reply('不依赖视觉信息的新片段。'))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'chatty'
    vi.useFakeTimers()
    await voice.start()
    const client = connection()
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledOnce())
    visualContext = ''
    await voice.updateVisualContext()
    expect(modelFetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    finish(reply('旧视觉内容不可播出'))
    await vi.advanceTimersByTimeAsync(2100)
    await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(1))
    expect(JSON.stringify(JSON.parse(String(modelFetch.mock.calls[1][1]?.body)).messages)).not.toContain('PUBLIC_TEST_OBSERVATION')
    expect(client.commands.find(command => command.type === 'speak')?.text).toBe('不依赖视觉信息的新片段。')
  })

  it('aIRI-023 applies the selected style at voice start, during a call, and to actual worker requests', async () => {
    const { voice, consciousness } = await fixture()
    const modelFetch = vi.fn<typeof fetch>().mockResolvedValue(reply(JSON.stringify({ status: 'completed', result_summary: '仅测试集 A 已验证。', suggested_utterance: '已验证。', delivery_policy: 'when_idle' })))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    voice.conversationStyle = 'listening'
    await voice.start()
    const client = connection()
    expect(client.commands.find(command => command.type === 'start')?.start.instructions).toContain('Current conversation style: listening')
    voice.conversationStyle = 'concise'
    await vi.waitFor(() => expect(client.commands.findLast(command => command.type === 'context')?.instructions).toContain('Current conversation style: concise'))
    client.event({ type: 'transcript', id: 'style-request', role: 'user', text: '请核对适用条件', final: true })
    client.event({ type: 'tools', calls: [{ call_id: 'style-work', name: 'spawn_thinking', arguments: '{"objective":"核对适用条件"}' }] })
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledOnce())
    const body = JSON.parse(String(modelFetch.mock.calls[0][1]?.body))
    expect(JSON.stringify(body.messages)).toContain('Current conversation style: concise')
    expect(JSON.stringify(body.messages)).toContain('应用原样朗读 result_summary')
    expect(localStorage.getItem('settings/realtime-voice/conversation-style')).toContain('concise')
    voice.conversationStyle = 'basic'
    await vi.waitFor(() => expect(client.commands.findLast(command => command.type === 'context')?.instructions).not.toContain('Current conversation style:'))
    expect(client.commands.findLast(command => command.type === 'context')?.instructions).toContain('暂停后的结果需要明确恢复')
  })

  it('aIRI-023 keeps background work running while delivery is paused and accepts model-controlled resumption', async () => {
    const { voice, consciousness, container } = await fixture()
    let finish!: (response: Response) => void
    const modelFetch = vi.fn<typeof fetch>(() => new Promise(resolve => finish = resolve))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    await voice.start()
    const client = connection()
    client.event({ type: 'transcript', id: 'quiet-user', role: 'user', text: '帮我查记录', final: true })
    client.event({ type: 'tools', calls: [{ call_id: 'quiet-work', name: 'spawn_thinking', arguments: '{"objective":"查记录"}' }] })
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledOnce())
    await userEvent.click([...container.querySelectorAll('button')].find(button => button.textContent?.includes('Pause result speech'))!)
    expect(voice.deliveryPaused).toBe(true)
    expect(voice.tasks[0].status).toBe('running')
    finish(reply(JSON.stringify({ status: 'completed', result_summary: '公开测试记录已核对。', suggested_utterance: '记录已核对。', delivery_policy: 'when_idle' })))
    await vi.waitFor(() => expect(voice.tasks[0]).toMatchObject({ status: 'completed', delivery: 'pending' }))
    await new Promise(resolve => setTimeout(resolve, 900))
    expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(0)
    client.event({ type: 'transcript', id: 'resume-user', role: 'user', text: '继续告诉我结果', final: true })
    client.event({ type: 'tools', calls: [{ call_id: 'resume-control', name: 'set_agent_delivery', arguments: '{"mode":"automatic"}' }] })
    await vi.waitFor(() => expect(client.commands.findLast(command => command.type === 'tool-results')?.results[0]).toMatchObject({ callId: 'resume-control', output: '{"paused":false,"tasks_cancelled":false}' }))
    await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(1), { timeout: 3000 })
    expect(modelFetch).toHaveBeenCalledOnce()
  })

  it('aIRI-023 resumes only the unconfirmed part of a long canonical result', async () => {
    const { voice, consciousness, sessions } = await fixture()
    const summary = `${'仅测试集 A：82%，跨领域未验证。'.repeat(28)}最后一条：不能保证其他条件成立。`
    const modelFetch = vi.fn<typeof fetch>().mockResolvedValue(reply(JSON.stringify({ status: 'completed', result_summary: summary, suggested_utterance: '全部通过。', delivery_policy: 'when_idle' })))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    await voice.start()
    const client = connection()
    client.event({ type: 'transcript', id: 'long-user', role: 'user', text: '核对所有条件', final: true })
    client.event({ type: 'tools', calls: [{ call_id: 'long-work', name: 'spawn_thinking', arguments: '{"objective":"核对所有条件"}' }] })
    await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(1), { timeout: 3000 })
    const first = client.commands.find(command => command.type === 'speak')!
    completeSpeech(client, first)
    await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(2), { timeout: 3000 })
    const second = client.commands.findLast(command => command.type === 'speak')!
    client.event({ type: 'audio', speechId: second.id, audio: btoa('\0\0') })
    client.event({ type: 'interrupt' })
    client.event({ type: 'activity', speaking: false, responding: false })
    expect(voice.deliveryPaused).toBe(true)
    voice.resumeDelivery()
    await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(3), { timeout: 3000 })
    const resumed = client.commands.findLast(command => command.type === 'speak')!
    expect(resumed.text).toBe(second.text)
    expect(first.text + resumed.text).toBe(summary)
    completeSpeech(client, resumed)
    await vi.waitFor(() => expect(voice.tasks[0].delivery).toBe('delivered'))
    await vi.waitFor(() => expect(sessions.messages.filter(message => message.role === 'assistant' && !message.interrupted).map(message => message.content).join('')).toBe(summary))
  })

  it('aIRI-023 reports one real waiting state without interrupting the user or inventing completion', async () => {
    const { voice, consciousness } = await fixture()
    const modelFetch = vi.fn<typeof fetch>(() => new Promise(() => {}))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    await voice.start()
    const client = connection()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    client.event({ type: 'transcript', id: 'waiting-user', role: 'user', text: '帮我核对记录', final: true })
    client.event({ type: 'tools', calls: [{ call_id: 'waiting-work', name: 'spawn_thinking', arguments: JSON.stringify({ objective: '核对记录', waiting_utterance: 'Background work is still running. I\'ll tell you when a confirmed result is ready.' }) }] })
    await vi.advanceTimersByTimeAsync(500)
    expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(1)
    completeSpeech(client, client.commands.find(command => command.type === 'speak')!)
    client.event({ type: 'activity', speaking: true, responding: false })
    await vi.advanceTimersByTimeAsync(15500)
    expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(1)
    client.event({ type: 'activity', speaking: false, responding: false })
    await vi.advanceTimersByTimeAsync(1000)
    expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(2)
    const notice = client.commands.findLast(command => command.type === 'speak')!
    expect(notice.text).toBe('Background work is still running. I\'ll tell you when a confirmed result is ready.')
    expect(voice.tasks[0].status).toBe('running')
    completeSpeech(client, notice)
    await vi.advanceTimersByTimeAsync(20000)
    expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(2)
    voice.stop()
    await vi.advanceTimersByTimeAsync(20000)
    expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(2)
  })

  // http://127.0.0.1:5174 — AIRI-023: result narration must preserve the canonical findings and their limits.
  // ROOT CAUSE: an independently generated suggested_utterance could contradict the verified summary.
  it('aIRI-023 keeps numbers and limitations instead of speaking a contradictory suggested rewrite', async () => {
    const { voice, consciousness, sessions } = await fixture()
    const summary = '测试集 A 的正确率为 82%，跨领域表现尚未验证。'
    const modelFetch = vi.fn<typeof fetch>().mockResolvedValue(reply(JSON.stringify({ status: 'completed', result_summary: summary, suggested_utterance: '正确率是 100%，各种场景都可以使用。', delivery_policy: 'when_idle' })))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    await voice.start()
    const client = connection()
    client.event({ type: 'transcript', id: 'accuracy-request', role: 'user', text: '核对测试结果', final: true })
    client.event({ type: 'tools', calls: [{ call_id: 'accuracy-call', name: 'spawn_thinking', arguments: '{"objective":"核对测试结果"}' }] })
    await vi.waitFor(() => expect(client.commands.some(command => command.type === 'speak')).toBe(true), { timeout: 3000 })
    const narration = client.commands.find(command => command.type === 'speak')!
    expect(narration.text).toBe(summary)
    client.event({ type: 'audio', speechId: narration.id, audio: btoa('\0\0') })
    client.event({ type: 'transcript', id: narration.id, role: 'assistant', text: narration.text, final: true })
    client.event({ type: 'audio-done', speechId: narration.id })
    boundary.playback.at(-1)!.end()
    await vi.waitFor(() => expect(sessions.messages.some(message => message.content === summary)).toBe(true))
    expect(JSON.stringify(sessions.messages)).not.toContain('100%')
  })

  // http://127.0.0.1:5174 — AIRI-023: interrupted results need user-controlled resumption, not automatic repetition.
  // ROOT CAUSE: interruption returned delivery to pending and immediately scheduled the entire result again.
  it('aIRI-023 pauses an interrupted result without cancelling work and resumes only on request', async () => {
    const { voice, consciousness } = await fixture()
    const summary = '后台核对已经完成，仍然需要检查适用条件。'
    const modelFetch = vi.fn<typeof fetch>().mockResolvedValue(reply(JSON.stringify({ status: 'completed', result_summary: summary, suggested_utterance: summary, delivery_policy: 'when_idle' })))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    await voice.start()
    const client = connection()
    client.event({ type: 'transcript', id: 'pause-request', role: 'user', text: '核对这条记录', final: true })
    client.event({ type: 'tools', calls: [{ call_id: 'pause-work', name: 'spawn_thinking', arguments: '{"objective":"核对这条记录"}' }] })
    await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(1), { timeout: 3000 })
    const narration = client.commands.find(command => command.type === 'speak')!
    client.event({ type: 'audio', speechId: narration.id, audio: btoa('\0\0') })
    client.event({ type: 'transcript', id: narration.id, role: 'assistant', text: narration.text, final: true })
    client.event({ type: 'interrupt' })
    client.event({ type: 'activity', speaking: false, responding: false })
    await new Promise(resolve => setTimeout(resolve, 1000))
    expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(1)
    expect(voice.tasks[0]).toMatchObject({ status: 'completed', delivery: 'pending' })
    voice.resumeDelivery()
    await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(2), { timeout: 3000 })
    expect(client.commands.findLast(command => command.type === 'speak')?.text).toBe(summary)
    expect(modelFetch).toHaveBeenCalledOnce()
  })

  // http://127.0.0.1:5174 — AIRI-022: a silent tool handoff kept the result pending until the user spoke again.
  // ROOT CAUSE: native activity retained the speaking slot; pending results also entered two voice output paths.
  it('aIRI-022 speaks one acceptance and proactively delivers one result with correlated playback confirmation', async () => {
    const { voice, consciousness, sessions } = await fixture()
    let finish!: (response: Response) => void
    const modelFetch = vi.fn<typeof fetch>(() => new Promise((resolve) => {
      finish = resolve
    }))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    await voice.start()
    const client = connection()
    client.event({ type: 'transcript', id: 'lookup-user', role: 'user', text: '请查询一条记录', final: true })
    client.event({ type: 'activity', speaking: false, responding: true })
    client.event({ type: 'tools', calls: [{ call_id: 'lookup-call', name: 'spawn_thinking', arguments: '{"objective":"查询一条记录"}' }] })
    await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(1), { timeout: 2500 })
    const acceptance = client.commands.find(command => command.type === 'speak')!
    expect(acceptance).toMatchObject({ id: expect.any(String) })
    client.event({ type: 'tools', calls: [{ call_id: 'lookup-repeat', name: 'spawn_thinking', arguments: '{"objective":"查询一条记录"}' }] })
    await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'tool-results')).toHaveLength(2))
    expect(voice.responding).toBe(true)
    expect(voice.tasks).toHaveLength(1)
    client.event({ type: 'audio', speechId: acceptance.id, audio: btoa('\0\0') })
    client.event({ type: 'transcript', id: acceptance.id, role: 'assistant', text: acceptance.text, final: true })
    client.event({ type: 'audio-done', speechId: acceptance.id })
    boundary.playback.at(-1)!.end()
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledOnce())
    finish(reply(JSON.stringify({ status: 'completed', result_summary: 'Only the application delivers this result.', suggested_utterance: '记录核对完成了。', delivery_policy: 'when_idle' })))
    await vi.waitFor(() => expect(voice.tasks[0]?.status).toBe('completed'))
    expect(voice.responding).toBe(false)
    await vi.waitFor(() => expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(2), { timeout: 2500 })
    const result = client.commands.findLast(command => command.type === 'speak')!
    expect(result.text).toBe('Only the application delivers this result.')
    const context = client.commands.findLast(command => command.type === 'context')!
    expect(context.instructions).not.toContain('Only the application delivers this result.')
    client.event({ type: 'audio', speechId: result.id, audio: btoa('\0\0') })
    client.event({ type: 'transcript', id: result.id, role: 'assistant', text: result.text, final: true })
    client.event({ type: 'audio-done', speechId: acceptance.id })
    boundary.playback.at(-1)!.end()
    expect(voice.tasks[0].delivery).toBe('speaking')
    client.event({ type: 'audio-done', speechId: result.id })
    await vi.waitFor(() => expect(voice.tasks[0].delivery).toBe('delivered'))
    client.event({ type: 'audio-done', speechId: result.id })
    await new Promise(resolve => setTimeout(resolve, 900))
    expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(2)
    expect(sessions.messages.filter(message => message.content === result.text)).toHaveLength(1)
  })

  // http://127.0.0.1:5174 — AIRI-021: voice refused a lookup that the text worker could execute.
  // ROOT CAUSE: the fast prompt omitted the worker's real web_search gate and conflated it with native search.
  it('aIRI-021 advertises the configured worker search capability at voice start', async () => {
    const { voice, consciousness } = await fixture()
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    const search = useWebSearchStore()
    search.enabled = true
    await voice.start()
    const start = connection().commands.find(command => command.type === 'start')!
    expect(start.start.slowBrain).toBe(true)
    expect(start.start.instructions).toContain('web_search')
    expect(start.start.instructions).toContain('spawn_thinking')
    expect(start.start.instructions).toContain('native search')
  })

  // http://127.0.0.1:5174 — AIRI-021: an existing call retained its original background-tool configuration.
  // ROOT CAUSE: model/tool changes were not watched, and context commands carried no worker availability.
  it('aIRI-021 updates background tools and capabilities in an already active voice call', async () => {
    const { voice, consciousness } = await fixture()
    await voice.start()
    const client = connection()
    const initial = client.commands.find(command => command.type === 'start')!
    expect(initial.start.slowBrain).toBe(false)
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    const search = useWebSearchStore()
    search.enabled = true
    await vi.waitFor(() => expect(client.commands.findLast(command => command.type === 'context')).toMatchObject({ slowBrain: true, instructions: expect.stringContaining('web_search') }))
    consciousness.activeModel = ''
    await vi.waitFor(() => expect(client.commands.findLast(command => command.type === 'context')).toMatchObject({ slowBrain: false }))
    expect(voice.status).toBe('listening')
  })

  it('updates the active fast context and UI after a real search error, a retry, and disabling search', async () => {
    const { voice, consciousness, container } = await fixture()
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    const search = useWebSearchStore()
    search.enabled = true
    await voice.start()
    const client = connection()
    const searchFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Account search forbidden' }), { status: 403 }))
    await expect(search.testSearch()).rejects.toThrow('403')
    await vi.waitFor(() => expect(client.commands.findLast(command => command.type === 'context')?.instructions).toContain('"web_search":"blocked"'))
    expect(client.commands.findLast(command => command.type === 'context')?.instructions).toContain('403')
    expect(container.textContent).toContain('Background web search paused')
    searchFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { web: [{ title: 'Source', url: 'https://source.example', description: 'Source excerpt' }] } })))
    await search.testSearch()
    await vi.waitFor(() => expect(client.commands.findLast(command => command.type === 'context')?.instructions).toContain('"web_search":"enabled"'))
    expect(container.textContent).toContain('Background web search enabled')
    search.enabled = false
    await vi.waitFor(() => expect(client.commands.findLast(command => command.type === 'context')?.instructions).toContain('"web_search":"disabled"'))
    expect(container.textContent).toContain('Background web search is not enabled')
    expect(voice.status).toBe('listening')
  })

  // http://127.0.0.1:5174 — AIRI-016, a text box rejected input when only Doubao was configured.
  // ROOT CAUSE:
  // Seeduplex greeting text is TTS, not a query. Text tasks use the selected worker with no microphone or voice connection.
  it('aIRI-016 runs typed input through the configured worker and stores the visible reply', async () => {
    const { input, voice, sessions, consciousness, container } = await fixture()
    const permission = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
    const modelFetch = vi.fn<typeof fetch>().mockImplementation(async () => reply(JSON.stringify({ status: 'completed', result_summary: 'Hello Stranger', suggested_utterance: 'Hello Stranger', delivery_policy: 'when_idle' })))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    await input.send({ sessionId: sessions.activeSessionId, text: 'Hello from text' })
    expect(permission).not.toHaveBeenCalled()
    expect(voice.mode).toBe('text')
    expect(boundary.clients.some(client => client.commands.some(command => command.type === 'start'))).toBe(false)
    await vi.waitFor(() => expect(sessions.messages.some(message => message.role === 'assistant' && message.content === 'Hello Stranger')).toBe(true), { timeout: 3000 })
    expect(sessions.messages.some(message => message.role === 'error')).toBe(false)
    await userEvent.click([...container.querySelectorAll('button')].find(button => button.textContent?.includes('Show tasks'))!)
    await userEvent.click([...container.querySelectorAll('button')].find(button => button.textContent?.includes('Revise task'))!)
    const editor = container.querySelector('textarea')!
    editor.value = 'Check the revised objective'
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await userEvent.click(container.querySelector('button[type="submit"]')!)
    await vi.waitFor(() => expect(voice.tasks[0]).toMatchObject({ task_version: 2, objective: 'Check the revised objective' }))
  })

  it('does not confirm generated voice text before playback drains and excludes interrupted output', async () => {
    const { voice, sessions, container } = await fixture()
    await userEvent.click(container.querySelector('button')!)
    await voice.start('voice')
    const client = connection()
    client.event({ type: 'audio', audio: btoa('\0\0') })
    client.event({ type: 'transcript', id: 'full', role: 'assistant', text: 'Complete spoken reply', final: true })
    client.event({ type: 'audio-done' })
    expect(sessions.messages.some(message => message.content === 'Complete spoken reply')).toBe(false)
    boundary.playback.at(-1)!.end()
    await vi.waitFor(() => expect(sessions.messages.some(message => message.content === 'Complete spoken reply')).toBe(true))
    client.event({ type: 'audio', audio: btoa('\0\0') })
    client.event({ type: 'transcript', id: 'partial', role: 'assistant', text: 'Generated but unheard ending', final: true })
    client.event({ type: 'interrupt' })
    await vi.waitFor(() => expect(sessions.messages.find(message => message.id?.endsWith(':partial'))).toMatchObject({ interrupted: true }))
    const context = client.commands.findLast(command => command.type === 'context')
    expect(JSON.stringify(context)).not.toContain('Generated but unheard ending')
  })

  it('runs a real background generation adapter, returns immediate acceptance, and waits for a conversation pause', async () => {
    const { voice, sessions, consciousness, container } = await fixture()
    let finish!: (response: Response) => void
    const modelFetch = vi.fn<typeof fetch>(() => new Promise((resolve) => {
      finish = resolve
    }))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    await voice.start()
    const client = connection()
    client.event({ type: 'transcript', id: 'user-record', role: 'user', text: 'Think carefully about this record', final: true })
    client.event({ type: 'tools', calls: [{ call_id: 'work', name: 'spawn_thinking', arguments: '{"objective":"Check the record"}' }] })
    await vi.waitFor(() => expect(client.commands.some(command => command.type === 'tool-results')).toBe(true))
    expect(voice.tasks[0].status).toBe('running')
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledOnce())
    // AIRI-043: background work leaves microphone input and native conversation available.
    const frame = btoa('\0'.repeat(640))
    boundary.input.at(-1)!(frame)
    expect(client.commands).toContainEqual({ type: 'audio', audio: frame })
    client.event({ type: 'activity', speaking: true, responding: false })
    client.event({ type: 'transcript', id: 'next-user', role: 'user', text: '先聊聊你喜欢什么歌', final: true })
    client.event({ type: 'activity', speaking: false, responding: true })
    client.event({ type: 'audio', audio: btoa('\0\0') })
    client.event({ type: 'transcript', id: 'next-answer', role: 'assistant', text: '我喜欢轻快的旋律。', final: true })
    client.event({ type: 'audio-done' })
    boundary.playback.at(-1)!.end()
    client.event({ type: 'activity', speaking: false, responding: false })
    await vi.waitFor(() => expect(sessions.messages.some(message => message.content === '我喜欢轻快的旋律。')).toBe(true))
    expect(voice.tasks[0].status).toBe('running')
    expect(voice.status).toBe('listening')
    boundary.input.at(-1)!(frame)
    expect(client.commands.filter(command => command.type === 'audio')).toHaveLength(2)
    client.event({ type: 'activity', speaking: true, responding: false })
    finish(reply(JSON.stringify({ status: 'completed', result_summary: 'The background result is ready.', suggested_utterance: '刚才的结果准备好了。', delivery_policy: 'when_idle' })))
    await vi.waitFor(() => expect(voice.tasks[0].status).toBe('completed'))
    expect(client.commands.some(command => command.type === 'speak')).toBe(false)
    expect(container.textContent).toContain('Waiting for a conversation pause')
    client.event({ type: 'activity', speaking: false, responding: false })
    await vi.waitFor(() => expect(client.commands.some(command => command.type === 'speak')).toBe(true), { timeout: 3000 })
    expect(voice.tasks[0].delivery).toBe('speaking')
    const body = JSON.parse(String(modelFetch.mock.calls[0][1]?.body))
    expect(JSON.stringify(body.messages)).toContain('Think carefully about this record')
    expect(body.tools.some((tool: { function: { name: string } }) => tool.function.name === 'read_conversation_records')).toBe(true)
    voice.stop()
    expect(voice.tasks).toHaveLength(0)
    client.event({ type: 'transcript', id: 'late', role: 'assistant', text: 'Late reply after closing', final: true })
    expect(sessions.messages.some(message => message.content === 'Late reply after closing')).toBe(false)
  })

  // http://127.0.0.1:5174 — AIRI-043: completing an old receipt discarded newer playback and response activity.
  // ROOT CAUSE: post-send cleanup had no turn guard. Only the originating turn can release native playback.
  it('aIRI-043 does not interrupt a newer reply when sending an old task receipt completes', async () => {
    const { voice, consciousness } = await fixture()
    const modelFetch = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    let receiptSent!: () => void
    boundary.sendBarrier = command => command.type === 'tool-results' ? new Promise(resolve => receiptSent = resolve) : Promise.resolve()
    await voice.start()
    const client = connection()
    client.event({ type: 'transcript', id: 'old-user', role: 'user', text: '准备练唱方法', final: true })
    client.event({ type: 'tools', calls: [{ call_id: 'old-work', name: 'spawn_thinking', arguments: '{"objective":"准备练唱方法"}' }] })
    await vi.waitFor(() => expect(receiptSent).toBeTypeOf('function'))
    client.event({ type: 'activity', speaking: true, responding: false })
    client.event({ type: 'transcript', id: 'new-user', role: 'user', text: '先聊点别的', final: true })
    client.event({ type: 'activity', speaking: false, responding: true })
    client.event({ type: 'audio', audio: btoa('\0\0') })
    receiptSent()
    await vi.waitFor(() => expect(client.commands.some(command => command.type === 'context')).toBe(true))
    // Allow the receipt continuation to finish. Native generation must retain its speech slot.
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(voice.responding).toBe(true)
    expect(voice.tasks[0].status).toBe('running')
    expect(client.commands.filter(command => command.type === 'speak')).toHaveLength(0)
  })

  it('executes a conversation database query through the model tool round and retains actual evidence', async () => {
    const { sessions, consciousness } = await fixture()
    await sessions.saveVoiceTranscript({ sessionId: sessions.activeSessionId, generation: sessions.getSessionGenerationValue(sessions.activeSessionId), userId: 'local', characterId: 'default', id: 'record', role: 'user', text: 'Record B is confirmed in this conversation.' })
    const modelFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response([
        `data: ${JSON.stringify({ id: 'tools', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'records-call', type: 'function', function: { name: 'read_conversation_records', arguments: '{"query":"Record B"}' } }] }, finish_reason: null }] })}\n\n`,
        `data: ${JSON.stringify({ id: 'tools', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
        'data: [DONE]\n\n',
      ].join(''), { headers: { 'Content-Type': 'text/event-stream' } }))
      .mockResolvedValueOnce(reply(JSON.stringify({ status: 'completed', result_summary: 'Record B is present.', suggested_utterance: '查到记录 B 了。', delivery_policy: 'when_idle' })))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    const progress = vi.fn()
    const result = await useSlowBrainStore().executor(sessions.activeSessionId)({ task_id: 'task-records', task_version: 1, objective: 'Find Record B', source_turn_id: 'record', status: 'running', delivery: 'pending', accepted_at: Date.now(), progress: { stage: 'working' } }, [{ id: 'record', role: 'user', text: 'Find Record B' }], new AbortController().signal, progress)
    expect(modelFetch).toHaveBeenCalledTimes(2)
    expect(result.evidence).toContainEqual({ source: 'tool:read_conversation_records', summary: expect.stringContaining('Record B is confirmed') })
    expect(progress.mock.calls).toEqual([[{ stage: 'tool_started', tool_name: 'read_conversation_records' }], [{ stage: 'tool_returned', tool_name: 'read_conversation_records' }]])
    const body = JSON.parse(String(modelFetch.mock.calls[1][1]?.body))
    expect(body.messages.some((message: { role: string, content: string }) => message.role === 'tool' && message.content.includes('Record B is confirmed'))).toBe(true)
  })

  it('routes voice delegation through the model-selected Firecrawl tool and speaks its result only in a pause', async () => {
    const { voice, sessions, consciousness } = await fixture()
    const search = useWebSearchStore()
    search.enabled = true
    search.provider = 'firecrawl'
    const searchFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, id: 'search-receipt', creditsUsed: 2, data: { web: [{ title: 'Verified source', url: 'https://source.example/news', description: 'A current finding.' }] } })))
    const modelFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response([
        `data: ${JSON.stringify({ id: 'tools', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'search-call', type: 'function', function: { name: 'web_search', arguments: '{"query":"current news","max_results":3,"time_range":null,"include_domains":null,"exclude_domains":null}' } }] }, finish_reason: null }] })}\n\n`,
        `data: ${JSON.stringify({ id: 'tools', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
        'data: [DONE]\n\n',
      ].join(''), { headers: { 'Content-Type': 'text/event-stream' } }))
      .mockResolvedValueOnce(reply(JSON.stringify({ status: 'completed', result_summary: 'A current finding.', suggested_utterance: '查询完成。', delivery_policy: 'when_idle' })))
    const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://model.test/', fetch: modelFetch } }) }
    consciousness.activeProvider = 'test-service'
    consciousness.activeModel = 'slow-test'
    vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
    await voice.start()
    const client = connection()
    client.event({ type: 'transcript', id: 'search-user', role: 'user', text: '帮我查一下今天南宁的天气', final: true })
    client.event({ type: 'activity', speaking: true, responding: false })
    client.event({ type: 'tools', calls: [{ call_id: 'voice-search', name: 'spawn_thinking', arguments: '{"objective":"查询南宁的最新天气并提供来源"}' }] })
    await vi.waitFor(() => expect(voice.tasks[0]?.status).toBe('completed'))
    const result = voice.tasks[0].result!
    expect(client.commands.find(command => command.type === 'tool-results')?.results[0]).toMatchObject({ callId: 'voice-search', output: expect.stringContaining('"accepted":true') })
    expect(client.commands.some(command => command.type === 'speak')).toBe(false)
    expect(searchFetch).toHaveBeenCalledTimes(1)
    expect(modelFetch).toHaveBeenCalledTimes(2)
    expect(result.evidence).toContainEqual({ source: 'tool:web_search', summary: expect.stringContaining('https://source.example/news') })
    expect(search.lastSearch?.requestId).toBe('search-receipt')
    const first = JSON.parse(String(modelFetch.mock.calls[0][1]?.body))
    expect(JSON.stringify(first.messages)).toContain('actually call the tool')
    expect(JSON.stringify(first.messages)).toContain('帮我查一下今天南宁的天气')
    const second = JSON.parse(String(modelFetch.mock.calls[1][1]?.body))
    expect(second.messages.some((message: { role: string, content: string }) => message.role === 'tool' && message.content.includes('https://source.example/news'))).toBe(true)
    client.event({ type: 'activity', speaking: false, responding: false })
    await vi.waitFor(() => expect(client.commands.find(command => command.type === 'speak')).toMatchObject({ text: result.result_summary }), { timeout: 3000 })
    expect(voice.tasks[0].delivery).toBe('speaking')
    const delivered = client.commands.find(command => command.type === 'speak')!
    client.event({ type: 'audio', speechId: delivered.id, audio: btoa('\0\0') })
    client.event({ type: 'transcript', id: delivered.id, role: 'assistant', text: result.result_summary, final: true })
    client.event({ type: 'audio-done', speechId: delivered.id })
    expect(voice.tasks[0].delivery).toBe('speaking')
    expect(sessions.messages.some(message => message.content === result.result_summary)).toBe(false)
    boundary.playback.at(-1)!.end()
    await vi.waitFor(() => expect(voice.tasks[0].delivery).toBe('delivered'))
    await vi.waitFor(() => expect(sessions.messages.some(message => message.content === result.result_summary)).toBe(true))
  })

  it('shows a configuration action when neither input model is configured', async () => {
    boundary.configured = false
    const { input, sessions, voice, container } = await fixture()
    await expect(input.send({ sessionId: sessions.activeSessionId, text: 'Hello' })).rejects.toThrow('Consciousness')
    expect(voice.errorCode).toBe('text-provider')
    expect(container.textContent).toContain('Select a slow-brain provider')
    expect(sessions.messages.some(message => message.role === 'error')).toBe(false)
  })
})
