import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import { useAiriCardStore } from '../modules/airi-card'
import { useChatSessionStore } from './session-store'

const syncedContexts: Array<{
  pinia: ReturnType<typeof createPinia>
  runtime: SyncedPiniaRuntime
  unmount: () => void
}> = []

function createSyncedContext(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({
    callTimeout: 1000,
    leadership,
    namespace,
  })
  pinia.use(runtime.plugin)
  const app = createApp({ setup() {
    useAiriCardStore()
    return () => null
  } })
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en } })).mount(document.createElement('div'))
  syncedContexts.push({ pinia, runtime, unmount: () => app.unmount() })
  return { pinia, runtime }
}

afterEach(() => {
  for (const context of syncedContexts.splice(0)) {
    context.unmount()
    context.runtime.dispose()
    disposePinia(context.pinia)
  }
  localStorage.clear()
})

describe('voice transcript synchronization', () => {
  it('persists follower voice transcripts once and rejects stale or deleted conversation targets', async () => {
    const namespace = `voice-history:${crypto.randomUUID()}`
    const leader = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
    const leaderStore = useChatSessionStore(leader.pinia)
    const follower = createSyncedContext(namespace, 'follower-only')
    await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leader.runtime.participantId))
    const followerStore = useChatSessionStore(follower.pinia)
    await followerStore.initialize()
    const sessionId = followerStore.activeSessionId
    const payload = {
      sessionId,
      generation: followerStore.getSessionGenerationValue(sessionId),
      userId: 'local',
      characterId: 'default',
      id: 'voice:reply',
      role: 'assistant' as const,
      text: 'Hello Stranger',
      localVisionDerived: true as const,
    }
    expect(await followerStore.saveVoiceTranscript(payload)).toBe(true)
    expect(await followerStore.saveVoiceTranscript({ ...payload, text: 'Updated reply' })).toBe(true)
    await vi.waitFor(() => expect(followerStore.messages.filter(message => message.id === payload.id)).toHaveLength(1))
    expect(leaderStore.getSessionMessages(sessionId).find(message => message.id === payload.id)).toMatchObject({
      role: 'assistant',
      content: 'Updated reply',
      slices: [{ type: 'text', text: 'Updated reply' }],
      tool_results: [],
      localVisionDerived: true,
    })
    expect(await followerStore.saveVoiceTranscript({ ...payload, userId: 'different-user' })).toBe(false)
    expect(await followerStore.saveVoiceTranscript({ ...payload, generation: payload.generation + 1 })).toBe(false)
    await followerStore.deleteSession(sessionId)
    expect(await followerStore.saveVoiceTranscript(payload)).toBe(false)
    expect(leaderStore.sessionMetas[sessionId]).toBeUndefined()
  })
})
