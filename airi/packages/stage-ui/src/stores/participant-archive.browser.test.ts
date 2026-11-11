import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import HistoryMessageFrame from '../components/scenarios/chat/components/history-message-frame.vue'

import { storage } from '../database/storage'
import { queryArchive } from '../services/chat-archive'
import { useChatSessionStore } from './chat/session-store'
import { useAiriCardStore } from './modules/airi-card'
import { useStageIdentityStore } from './stage-identity'

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  localStorage.clear()
})

async function fixture() {
  localStorage.clear()
  await storage.clear()
  const pinia = createPinia()
  const app = createApp({ setup: () => {
    useAiriCardStore()
    return () => null
  } })
  const root = document.createElement('div')
  document.body.append(root)
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en } })).mount(root)
  cleanups.push(() => {
    app.unmount()
    disposePinia(pinia)
    root.remove()
  })
  const identity = useStageIdentityStore(pinia)
  const sessions = useChatSessionStore(pinia)
  await sessions.initialize()
  return { pinia, identity, sessions }
}

// http://127.0.0.1:5174 — AIRI-045: face leases changed the selected account and interrupted stage conversations.
it('aIRI-045 keeps the login, selected session and stage messages stable across named, anonymous and missing faces', async () => {
  const { identity, sessions } = await fixture()
  const session = sessions.activeSessionId
  sessions.appendSessionMessage(session, { id: 'generated-existing', role: 'user', content: 'Generated existing conversation' })
  await identity.setCameraIdentity({ person_id: 'generated-a', display_name: 'Generated A' }, Date.now() + 2000)
  expect(identity.userId).toBe('local')
  expect(sessions.activeSessionId).toBe(session)
  await identity.setCameraIdentity(null)
  await identity.setCameraIdentity({ person_id: 'generated-anonymous', display_name: '' }, Date.now() + 2000)
  expect(identity.userId).toBe('local')
  expect(sessions.activeSessionId).toBe(session)
  expect(sessions.sessionMessages[session].some(message => message.id === 'generated-existing')).toBe(true)
})

it('aIRI-045 archives individual turns by permanent person ID without splitting the stage session', async () => {
  const { identity, sessions } = await fixture()
  const session = sessions.activeSessionId
  await identity.setCameraIdentity({ person_id: 'generated-a', display_name: '' }, Date.now() + 10000)
  sessions.appendSessionMessage(session, { id: 'generated-a-user', role: 'user', content: 'Generated A introduction' })
  await identity.setCameraIdentity({ person_id: 'generated-b', display_name: 'Generated B' }, Date.now() + 10000)
  sessions.appendSessionMessage(session, { id: 'generated-a-answer', role: 'assistant', content: 'Generated answer for A', slices: [], tool_results: [] })
  sessions.appendSessionMessage(session, { id: 'generated-b-welcome', role: 'assistant', content: 'Generated proactive welcome for B', slices: [], tool_results: [], localVisionDerived: true })
  sessions.appendSessionMessage(session, { id: 'generated-b-user', role: 'user', content: 'Generated B conversation' })
  await sessions.saveVoiceTranscript({ sessionId: session, userId: 'local', characterId: 'default', generation: sessions.getSessionGeneration(session), id: 'generated-b-voice', role: 'user', text: 'Generated B voice' })
  const scope = (id: string) => ({ userId: `local-face:${id}`, characterId: 'default', assertCurrent: () => {} })
  const a = await queryArchive(scope('generated-a'))
  const b = await queryArchive(scope('generated-b'))
  expect(a.messages.map(message => message.messageId)).toEqual(['generated-a-user', 'generated-a-answer'])
  expect(b.messages.map(message => message.messageId)).toEqual(['generated-b-welcome', 'generated-b-user', 'generated-b-voice'])
  expect(sessions.activeSessionId).toBe(session)
})

it('aIRI-045 updates a small archive label after naming without replacing its permanent ID', async () => {
  const { pinia, identity } = await fixture()
  const archive = { personId: 'generated-label', displayName: '', characterName: 'AIRI' }
  await identity.setCameraIdentity({ person_id: archive.personId, display_name: '' }, Date.now() + 10000)
  const screen = render(HistoryMessageFrame, { props: { archive, role: 'user' }, slots: { default: 'Generated bubble' }, global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })] } })
  await identity.setCameraIdentity({ person_id: archive.personId, display_name: 'Generated Name' }, Date.now() + 10000)
  await expect.element(screen.getByText('AIRI-Generated Name', { exact: true })).toBeVisible()
  expect(archive.personId).toBe('generated-label')
  const label = document.querySelector('[data-archive-person="generated-label"]')!
  expect(label.getAttribute('data-archive-person')).toBe(archive.personId)
  expect(identity.userId).toBe('local')
  screen.unmount()
})

it('aIRI-045 forgets one person inside a shared stage conversation and preserves other people', async () => {
  const { identity, sessions } = await fixture()
  const session = sessions.activeSessionId
  await identity.setCameraIdentity({ person_id: 'generated-forget-a', display_name: 'Generated A' }, Date.now() + 10000)
  sessions.appendSessionMessage(session, { id: 'delete-a', role: 'user', content: 'Generated A data' })
  await identity.setCameraIdentity({ person_id: 'generated-keep-b', display_name: 'Generated B' }, Date.now() + 10000)
  await sessions.saveVoiceTranscript({ sessionId: session, userId: 'local', characterId: 'default', generation: sessions.getSessionGeneration(session), id: 'keep-b', role: 'user', text: 'Generated B data' })
  await sessions.forgetLocalPerson('generated-forget-a')
  expect(sessions.activeSessionId).toBe(session)
  expect(sessions.messages.some(message => message.id === 'delete-a')).toBe(false)
  expect(sessions.messages.some(message => message.id === 'keep-b')).toBe(true)
  const scope = (personId: string) => ({ userId: `local-face:${personId}`, characterId: 'default', assertCurrent: () => {} })
  expect((await queryArchive(scope('generated-forget-a'))).messages).toHaveLength(0)
  expect((await queryArchive(scope('generated-keep-b'))).messages.map(message => message.messageId)).toEqual(['keep-b'])
})
