import type { LeadershipMode } from 'pinia-plugin-synced'

import type { ChatSessionRecord } from '../types/chat-session'

import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import { chatSessionsRepo } from '../database/repos/chat-sessions.repo'
import { storage } from '../database/storage'
import { queryArchive } from '../services/chat-archive'
import { useChatSessionStore } from './chat/session-store'
import { useAiriCardStore } from './modules/airi-card'
import { useStageIdentityStore } from './stage-identity'

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  vi.restoreAllMocks()
  localStorage.clear()
})

async function seed(userId: string, characterId: string, id: string) {
  const record: ChatSessionRecord = {
    meta: { sessionId: id, userId, characterId, createdAt: 1, updatedAt: 1 },
    messages: [{ id: `${id}-message`, role: 'user', content: `Generated memory ${id}` }],
  }
  const index = await chatSessionsRepo.getIndex(userId) ?? { userId, characters: {} }
  index.characters[characterId] = { activeSessionId: id, sessions: { [id]: record.meta } }
  await chatSessionsRepo.saveIndex(index)
  await chatSessionsRepo.saveSession(id, record)
  await storage.setItemRaw(`local:chat/annotations/${id}/${id}-message`, { starred: true, note: 'Generated note', summary: 'Generated summary', tags: ['generated'], author: 'user', updatedAt: 1 })
}

function context(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 5000 })
  pinia.use(runtime.plugin)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ setup: () => {
    useAiriCardStore()
    return () => null
  } })
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en } })).mount(root)
  cleanups.push(() => {
    app.unmount()
    runtime.dispose()
    disposePinia(pinia)
    root.remove()
  })
  return { pinia, runtime, identity: useStageIdentityStore(pinia), sessions: useChatSessionStore(pinia) }
}

// http://127.0.0.1:5174 — AIRI-042: profile deletion left browser originals and annotations available for recall.
it('aIRI-042 forgets all characters and unloaded history on the leader, revokes both windows, and preserves other people', async () => {
  localStorage.clear()
  await storage.clear()
  const person = { person_id: 'generated-forget', display_name: 'Generated Person' }
  const userId = `local-face:${person.person_id}`
  await seed(userId, 'default', 'generated-first')
  await seed(userId, 'other-character', 'generated-unloaded')
  await seed('local-face:generated-other', 'default', 'generated-other')
  await seed('local', 'default', 'generated-guest')
  expect(await storage.getKeys('local:chat/annotations/generated-other')).toHaveLength(1)
  await chatSessionsRepo.enqueueOutbox(userId, { sessionId: 'generated-first', messageId: 'generated-first-message', role: 'user', content: 'Generated pending', attempts: 0, queuedAt: 1 })
  const namespace = `forget:${crypto.randomUUID()}`
  const leader = context(namespace, 'leader-only')
  await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
  await leader.identity.setCameraIdentity(person, Date.now() + 60000)
  await leader.sessions.initialize()
  const stageSession = leader.sessions.activeSessionId
  leader.sessions.appendSessionMessage(stageSession, { id: 'generated-live', role: 'user', content: 'Generated current face record' })
  await leader.sessions.saveVoiceTranscript({ sessionId: stageSession, generation: leader.sessions.getSessionGeneration(stageSession), userId: 'local', characterId: 'default', id: 'generated-barrier', role: 'user', text: 'Generated voice record' })
  const generation = leader.sessions.getSessionGeneration('generated-first')
  const follower = context(namespace, 'follower-only')
  await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leader.runtime.participantId))
  await vi.waitFor(() => expect(follower.identity.archiveUserId).toBe(userId))
  await follower.sessions.initialize()
  await vi.waitFor(() => expect(follower.sessions.sessionMessages[stageSession]?.some(message => message.id === 'generated-live')).toBe(true))
  let leaderCalls = 0
  leader.sessions.$onAction(({ name }) => {
    if (name === 'forgetLocalPerson')
      leaderCalls++
  })
  await follower.sessions.forgetLocalPerson(person.person_id)
  await vi.waitFor(() => expect(follower.identity.userId).toBe('local'))
  await vi.waitFor(() => expect(follower.sessions.sessionMetas['generated-first']).toBeUndefined())
  await vi.waitFor(() => expect(follower.sessions.sessionMessages[stageSession]?.some(message => message.id === 'generated-live')).toBe(false))
  expect(leaderCalls).toBe(1)
  expect(leader.identity.userId).toBe('local')
  expect(leader.sessions.sessionMetas['generated-first']).toBeUndefined()
  expect(follower.sessions.sessionMessages['generated-first']).toBeUndefined()
  expect(await chatSessionsRepo.getIndex(userId)).toBeNull()
  expect(await chatSessionsRepo.getSession('generated-first')).toBeNull()
  expect(await chatSessionsRepo.getSession('generated-unloaded')).toBeNull()
  expect(await storage.getKeys('local:chat/annotations/generated-first')).toHaveLength(0)
  expect(await storage.getKeys('local:chat/annotations/generated-unloaded')).toHaveLength(0)
  expect(await chatSessionsRepo.getOutbox(userId)).toHaveLength(0)
  expect(await chatSessionsRepo.getSession('generated-other')).not.toBeNull()
  expect(await chatSessionsRepo.getSession('generated-guest')).not.toBeNull()
  expect(await storage.getKeys('local:chat/annotations/generated-other')).toHaveLength(1)
  expect(await leader.sessions.saveVoiceTranscript({ sessionId: 'generated-first', generation, userId, characterId: 'default', id: 'late-turn', role: 'user', text: 'Late old conversation' })).toBe(false)
  await follower.sessions.forgetLocalPerson(person.person_id)
  expect(await chatSessionsRepo.getIndex(userId)).toBeNull()
  const nextUser = 'local-face:generated-new-profile'
  await follower.identity.setCameraIdentity({ person_id: 'generated-new-profile', display_name: person.display_name }, Date.now() + 60000)
  await follower.sessions.activateCurrentUser()
  const page = await queryArchive({ userId: nextUser, characterId: 'default', assertCurrent: () => {} })
  expect(page.messages).toHaveLength(0)
  expect(await chatSessionsRepo.getSession('generated-first')).toBeNull()
})
