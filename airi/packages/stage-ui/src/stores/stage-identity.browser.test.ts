import type { Observation, SocialState } from '@proj-airi/local-vision/contracts'

import en from '@proj-airi/i18n/locales/en'
import zh from '@proj-airi/i18n/locales/zh-Hans'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import LocalVisionRuntime from '../../../../apps/stage-web/src/components/local-vision-runtime.vue'
import HeaderAvatar from '../../../stage-layouts/src/components/Layouts/HeaderAvatar.vue'

import { storage } from '../database/storage'
import { setupSynced } from '../libs/pinia'
import { useAuthStore } from './auth'
import { createUserAccountContext } from './chat/context-providers/user-account'
import { useChatSessionStore } from './chat/session-store'
import { useLocalVisionStore } from './local-vision'
import { useStageIdentityStore } from './stage-identity'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0))
    cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

function actor(id: string, name: string): Observation['payload']['actors'][number] {
  return { track_id: id, bbox: [0.1, 0.1, 0.9, 0.9], face_bbox: [0.3, 0.1, 0.5, 0.3], primary: true, identity_status: 'confirmed', person_id: id, display_name: name, visible_cues: [] }
}

async function stage() {
  localStorage.clear()
  await storage.clear()
  await fetch('/api/local-vision/test-reset', { method: 'POST' })
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 240
  const media = canvas.captureStream(15)
  const painting = setInterval(() => canvas.getContext('2d')!.fillRect(0, 0, 320, 240), 50)
  const camera = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(media)
  const pinia = createPinia()
  const synced = setupSynced({ leadership: 'leader-only' })
  pinia.use(synced.pinia)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push('/')
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ render: () => h('div', [h(HeaderAvatar), h(LocalVisionRuntime)]) })
  app.use(pinia).use(synced.vue).use(router).use(createI18n({ legacy: false, locale: 'zh-Hans', fallbackLocale: 'en', messages: { en, 'zh-Hans': zh } })).mount(container)
  const local = useLocalVisionStore(pinia)
  const identity = useStageIdentityStore(pinia)
  const sessions = useChatSessionStore(pinia)
  const auth = useAuthStore(pinia)
  cleanups.push(() => {
    local.setMode('passive')
    app.unmount()
    disposePinia(pinia)
    clearInterval(painting)
    media.getTracks().forEach(track => track.stop())
    container.remove()
  })
  await vi.waitFor(() => expect(local.processedFrames).toBeGreaterThan(0), { timeout: 5000 })
  async function scene(actors: Observation['payload']['actors'], nameState?: SocialState['learning']['name_state'], paused = false) {
    const response = await fetch(`/api/local-vision/bindings/${local.source!.session_binding_id}/test-scene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actors, nameState, paused }),
    })
    expect(response.ok).toBe(true)
  }
  return { local, identity, sessions, auth, container, camera, scene }
}

it('aIRI-034 switches the visible account and persisted conversations without restarting capture', async () => {
  const { local, identity, sessions, auth, container, camera, scene } = await stage()
  await scene([])
  await vi.waitFor(() => expect(identity.userId).toBe('local'))
  expect(container.querySelector('[aria-label="本地账户：陌生人"]')).not.toBeNull()
  const id = `face-${crypto.randomUUID()}`
  await scene([actor(id, '测试人物甲')])
  await vi.waitFor(() => expect(identity.userId).toBe(`local-face:${id}`))
  await vi.waitFor(() => expect(sessions.sessionMetas[sessions.activeSessionId]?.userId).toBe(identity.userId))
  const firstSession = sessions.activeSessionId
  const source = local.source!.session_binding_id
  expect(container.querySelector('[aria-label="本地账户：测试人物甲"]')).not.toBeNull()
  // http://127.0.0.1:5174 — AIRI-036: the face-account branch hid the settings link.
  // ROOT CAUSE: settings belonged to the guest branch. Keep the noncompact settings link outside account branches.
  expect(container.querySelector('a[href="/settings"]')).not.toBeNull()
  const message = { id: crypto.randomUUID(), role: 'user' as const, content: '测试人物甲的独立记录' }
  sessions.appendSessionMessage(firstSession, message)
  await sessions.persistSessionMessages(firstSession)
  await scene([actor(`${id}-second`, '测试人物乙')])
  await vi.waitFor(() => expect(identity.displayName).toBe('测试人物乙'))
  await vi.waitFor(() => expect(sessions.sessionMetas[sessions.activeSessionId]?.userId).toBe(identity.userId))
  expect(sessions.activeSessionId).not.toBe(firstSession)
  expect(sessions.messages.some(item => item.id === message.id)).toBe(false)
  expect(createUserAccountContext(auth, '陌生人', identity).text).toContain('测试人物乙')
  expect(createUserAccountContext(auth, '陌生人', identity).text).not.toContain('测试人物甲')
  await scene([])
  await vi.waitFor(() => expect(identity.userId).toBe('local'))
  await vi.waitFor(() => expect(sessions.sessionMetas[sessions.activeSessionId]?.userId).toBe('local'))
  expect(sessions.messages.some(item => item.id === message.id)).toBe(false)
  await scene([actor(id, '测试人物甲改名')])
  await vi.waitFor(() => expect(identity.displayName).toBe('测试人物甲改名'))
  await vi.waitFor(() => expect(sessions.activeSessionId).toBe(firstSession))
  expect(sessions.messages.some(item => item.id === message.id)).toBe(true)
  expect(local.source!.session_binding_id).toBe(source)
  expect(camera).toHaveBeenCalledOnce()
  expect(auth.isAuthenticated).toBe(false)
  expect(auth.token).toBeNull()
  expect(identity.cloudSyncAllowed).toBe(false)
  expect(sessions.cloudSyncReady).toBe(false)
})

it('aIRI-034 revokes accounts for multiple faces, name correction, permission withdrawal and expired frames', async () => {
  const { local, identity, scene } = await stage()
  const person = actor(`face-${crypto.randomUUID()}`, '测试人物')
  await scene([person])
  await vi.waitFor(() => expect(identity.displayName).toBe(person.display_name))
  await scene([person, { ...actor('second', '另一测试人物'), primary: false }])
  await vi.waitFor(() => expect(identity.person).toBeNull())
  await scene([person], 'correcting')
  await vi.waitFor(() => expect(local.learning?.name_state).toBe('correcting'), { timeout: 3000 })
  expect(identity.person).toBeNull()
  await scene([person], 'confirmed')
  await vi.waitFor(() => expect(identity.displayName).toBe(person.display_name), { timeout: 3000 })
  local.permissions.names = false
  await vi.waitFor(() => expect(identity.person).toBeNull())
  local.permissions.names = true
  await vi.waitFor(() => expect(identity.displayName).toBe(person.display_name))
  await scene([person], 'confirmed', true)
  await vi.waitFor(() => expect(identity.person).toBeNull(), { timeout: 4000 })
  expect(identity.userId).toBe('local')
  local.setMode('passive')
  expect(identity.person).toBeNull()
})

it('aIRI-034 replicates identity without follower proposals and expires it without a capture callback', async () => {
  const namespace = `face-account:${crypto.randomUUID()}`
  function renderer(leadership: 'leader-only' | 'follower-only') {
    const pinia = createPinia()
    const runtime = createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 1000 })
    pinia.use(runtime.plugin)
    createApp({}).use(pinia)
    const identity = useStageIdentityStore(pinia)
    cleanups.push(() => {
      runtime.dispose()
      disposePinia(pinia)
    })
    return { identity, runtime }
  }
  const leader = renderer('leader-only')
  await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
  const follower = renderer('follower-only')
  await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leader.runtime.participantId))
  let leaderMutations = 0
  leader.identity.$subscribe(() => leaderMutations++)
  await leader.identity.setCameraIdentity({ person_id: 'generated-person', display_name: '测试人物' }, Date.now() + 500)
  await vi.waitFor(() => expect(follower.identity.displayName).toBe('测试人物'))
  expect(follower.identity.userId).toBe('local-face:generated-person')
  const mutationsAfterPublication = leaderMutations
  await vi.waitFor(() => expect(follower.identity.userId).toBe('local'))
  expect(leaderMutations).toBe(mutationsAfterPublication)
})
