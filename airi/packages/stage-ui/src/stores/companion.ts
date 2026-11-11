import { streamFrom } from '@proj-airi/core-agent'
import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { registerLocalVisionInput } from '../services/local-vision-context'
import { useSpeakingStore } from './audio'
import { useChatStore } from './chat'
import { useChatSessionStore } from './chat/session-store'
import { useLocalVisionStore } from './local-vision'
import { useAiriCardStore } from './modules/airi-card'
import { useBrainPromptsStore } from './modules/brain-prompts'
import { useConsciousnessStore } from './modules/consciousness'
import { useRealtimeVoiceStore } from './modules/realtime-voice'
import { useSpeechOutputControlStore } from './speech-output-control'
import { useSpeechRuntimeStore } from './speech-runtime'
import { useStageIdentityStore } from './stage-identity'
import { useStageRuntimeStore } from './stage-runtime'
import { useVoiceActivityStore } from './voice-activity'

/** Owns one event-driven thought and output. User activity, loss of sight, or mode changes cancel pending work. */
export const useCompanionStore = defineStore('companion', () => {
  const local = useLocalVisionStore()
  const chat = useChatStore()
  const sessions = useChatSessionStore()
  const cards = useAiriCardStore()
  const prompts = useBrainPromptsStore()
  const consciousness = useConsciousnessStore()
  const realtime = useRealtimeVoiceStore()
  const speech = useSpeechRuntimeStore()
  const control = useSpeechOutputControlStore()
  const speaking = useSpeakingStore()
  const voice = useVoiceActivityStore()
  const identity = useStageIdentityStore()
  const runtime = useStageRuntimeStore()
  const { t } = useI18n()
  const thinking = ref(false)
  const modelError = ref(false)
  const modelReady = computed(() => !!(consciousness.activeProvider && consciousness.activeModel) || realtime.configured)
  const busy = computed(() => chat.sending || chat.pendingQueuedSendCount > 0 || speaking.nowSpeaking
    || voice.busy || realtime.userSpeaking || realtime.responding || realtime.status === 'connecting')
  let controller: AbortController | undefined
  let intent: ReturnType<typeof speech.openIntent> | undefined
  let generation = 0
  let ticking = false
  let contextAt = 0
  let autoCallTrack = ''
  let autoCallOwned = false
  let personSeenAt = 0
  let promptedName = ''

  async function maintainVoice() {
    const now = performance.now()
    const actors = local.isFresh() ? local.result?.snapshot.payload.actors : undefined
    const actor = actors?.length === 1 && actors[0].primary ? actors[0] : undefined
    const allowed = local.mode === 'active' && local.owner && local.permissions.greetings && !document.hidden
    // Presence keeps an existing call alive. Account selection and automatic entry still require one eligible visitor.
    if (allowed && actors?.length)
      personSeenAt = now
    if (!allowed || !actor || ['unavailable', 'ambiguous'].includes(actor.identity_status)) {
      if (autoCallOwned && (!allowed || now - personSeenAt > 30000)) {
        realtime.stop()
        autoCallOwned = false
      }
      if (now - personSeenAt > 10000)
        autoCallTrack = ''
      return
    }
    personSeenAt = now
    // One configured call per encounter. Manual stop and the ten-minute limit never cause an automatic reconnect.
    // Ordinary input stays enabled. The page pauses its ASR consumer while the realtime call owns listening.
    const encounter = `${actor.track_id}:${identity.userId}`
    if (encounter !== autoCallTrack && realtime.configured && !realtime.active && !busy.value && speech.isHost()) {
      autoCallTrack = encounter
      autoCallOwned = true
      await realtime.start()
    }
  }

  function cancel() {
    generation++
    controller?.abort()
    controller = undefined
    intent?.cancel('companion-cancelled')
    intent = undefined
    thinking.value = false
  }

  async function compose(fallback: string, eventId: string) {
    if (!consciousness.activeProvider || !consciousness.activeModel || !local.permissions.observations)
      return fallback
    controller = new AbortController()
    const timeout = setTimeout(() => controller?.abort(), 15000)
    let text = ''
    try {
      const provider = await consciousness.getChatProviderInstance(consciousness.activeProvider)
      await streamFrom({
        model: consciousness.activeModel,
        chatProvider: provider,
        conversation: { turns: [{
          type: 'system',
          id: eventId,
          authority: 'system',
          content: [{ type: 'text', text: [
            cards.systemPrompt.slice(0, 8000),
            'A local companion event invites you to start a brief, natural conversation. Nobody has sent a new user message. Ask one considerate question in the interface language. Use only actual quoted memories. Do not invent shared experiences or infer feelings from facial cues. Return spoken text only, at most two sentences. Do not execute tools.',
            prompts.config.speech,
            local.project(sessions.activeSessionId),
            `Suggested opening: ${JSON.stringify(fallback)}`,
          ].join('\n\n') }],
        }] },
        options: {
          supportsTools: false,
          tools: [],
          abortSignal: controller.signal,
          onStreamEvent(event) {
            if (event.type === 'text-delta')
              text += event.text
          },
        },
      })
      modelError.value = false
      return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\|[^>]*\|>/g, '').trim().slice(0, 500) || fallback
    }
    catch {
      modelError.value = true
      return fallback
    }
    finally { clearTimeout(timeout) }
  }

  async function tick() {
    if (!runtime.enabled || ticking)
      return
    ticking = true
    try {
      await maintainVoice()
      // The realtime provider receives bounded changes, never camera images or one message per frame.
      if (realtime.active && performance.now() - contextAt > 10000) {
        contextAt = performance.now()
        await realtime.updateVisualContext().catch(() => {
          modelError.value = true
        })
      }
      const actor = local.result?.snapshot.payload.actors.find(actor => actor.primary)
      const learning = local.learning
      const confirmation = local.permissions.face && local.permissions.names && local.permissions.observations
        && learning?.name && (learning.name_state === 'confirming' || learning.name_state === 'correcting')
      const nameKey = confirmation && actor ? JSON.stringify([local.source, actor.track_id, learning.name, learning.name_state]) : ''
      // A final ASR turn can reach the registry after the provider has already answered.
      // Give its pending spelling check one independent speech opportunity, without a fabricated user turn.
      const introduction = nameKey && nameKey !== promptedName && local.isFresh() && local.mode === 'active'
        && local.permissions.greetings && !busy.value && !thinking.value && !document.hidden
      const event = introduction
        ? { eventId: crypto.randomUUID(), key: actor!.person_id ?? 'anonymous', name: null, kind: 'introduction' as const }
        : local.candidate(busy.value || thinking.value || document.hidden)
      if (!event || !local.owner)
        return
      // Camera greetings share the call's speech owner. Only periodic camera small talk yields to chatty continuation.
      if (realtime.active && realtime.conversationStyle === 'chatty' && event.kind === 'chat')
        return
      const current = generation
      const sessionId = sessions.activeSessionId
      if (!actor)
        return
      await local.readSocial(event.kind === 'greeting' && !event.name)
      if (generation !== current || busy.value)
        return
      if (realtime.active && realtime.conversationStyle === 'chatty' && realtime.slowBrainConfigured) {
        const text = await realtime.greet()
        if (text) {
          if (generation === current && local.isFresh() && local.owner)
            local.showGreeting(event, text)
          if (introduction && generation === current)
            promptedName = nameKey
          return
        }
        // A failed optional draft must not erase the encounter. The existing local welcome stays available.
        if (generation !== current || busy.value || !local.isFresh() || !local.owner)
          return
      }
      const allowedName = local.permissions.names ? event.name : null
      const welcome = local.permissions.face && local.permissions.names && local.learning?.awaiting_name ? 'hello' : 'hello-visitor'
      let text = allowedName ? t('settings.local-vision.hello-name', { name: allowedName }) : t(`settings.local-vision.${welcome}`)
      if (introduction)
        text = t('settings.local-vision.confirm-name', { name: learning!.name })
      if (event.kind === 'greeting' && allowedName && local.profile?.memories.length)
        text = `${text} ${t('settings.local-vision.memory-chat', { name: allowedName, memory: local.profile.memories[0].text.slice(0, 100) })}`
      if (event.kind === 'chat') {
        const memory = local.permissions.names ? local.profile?.memories[0] : undefined
        text = memory
          ? t('settings.local-vision.memory-chat', { name: allowedName ?? t('base.guest.name'), memory: memory.text.slice(0, 100) })
          : t('settings.local-vision.idle-chat')
        thinking.value = true
        text = await compose(text, event.eventId)
        thinking.value = false
      }
      else if (realtime.conversationStyle !== 'chatty') {
        thinking.value = true
        text = await compose(text, event.eventId)
        thinking.value = false
      }
      const visible = local.isFresh() && local.result?.snapshot.payload.actors.find(item => item.primary)?.track_id === actor.track_id
      if (generation !== current || !visible || busy.value || !local.active || local.mode !== 'active' || sessionId !== sessions.activeSessionId)
        return
      if (realtime.active && !control.speechMuted && !await realtime.speak(text))
        return
      local.showGreeting(event, text)
      if (introduction)
        promptedName = nameKey
      if (!realtime.active) {
        sessions.appendSessionMessage(sessionId, {
          id: event.eventId,
          role: 'assistant',
          content: text,
          createdAt: Date.now(),
          slices: [{ type: 'text', text }],
          tool_results: [],
          localVisionDerived: true,
        })
      }
      if (control.speechMuted || (!realtime.active && !speech.isHost()))
        return
      if (!realtime.active) {
        intent = speech.openIntent({ ownerId: 'local-vision', intentId: event.eventId, behavior: 'queue', priority: -10 })
        intent.writeLiteral(text)
        intent.end()
      }
    }
    catch { modelError.value = true }
    finally { ticking = false }
  }

  // Compare the encounter values. A new snapshot of the same visitor must not cancel pending conversation work.
  watch([
    () => local.mode,
    () => local.active,
    () => local.owner,
    () => local.permissions.greetings,
    () => local.permissions.names,
    () => sessions.activeSessionId,
    () => cards.activeCardId,
    () => realtime.conversationStyle,
    () => local.result?.snapshot.payload.primary_track_id,
    () => local.result?.snapshot.payload.actors.find(actor => actor.primary)?.person_id,
  ], cancel, { flush: 'sync' })
  watch(() => local.mode, (mode) => {
    autoCallTrack = ''
    promptedName = ''
    if (mode === 'passive' && autoCallOwned) {
      realtime.stop()
      autoCallOwned = false
    }
  }, { flush: 'sync' })
  watch(() => runtime.enabled, (enabled) => {
    if (!enabled) {
      cancel()
      autoCallTrack = ''
      autoCallOwned = false
      contextAt = 0
      promptedName = ''
    }
  }, { flush: 'sync' })
  watch([
    () => local.projectScope(sessions.activeSessionId),
    () => local.profile?.memories[0]?.at,
    () => local.learning?.name,
    () => local.learning?.learning,
    () => realtime.status,
  ], () => {
    void realtime.updateVisualContext().catch(() => {
      modelError.value = true
    })
  })
  watch(() => chat.sending || voice.busy || realtime.userSpeaking, (value) => {
    if (value)
      cancel()
  }, { flush: 'sync' })
  watch(() => control.latestStopRequest, () => {
    cancel()
    local.suppressGreeting()
  })
  const stopInput = registerLocalVisionInput(async (text, sessionId) => {
    cancel()
    await local.hear(text, sessionId)
  })
  watch(() => realtime.finalUserTurn, async (turn) => {
    if (!turn || !local.owner)
      return
    cancel()
    await local.hear(turn.text, turn.sessionId, turn.id)
    await realtime.updateVisualContext().catch(() => {
      modelError.value = true
    })
  })
  onScopeDispose(() => {
    cancel()
    if (autoCallOwned)
      realtime.stop()
    stopInput()
  })
  return { thinking, modelError, modelReady, busy, tick, cancel }
})
