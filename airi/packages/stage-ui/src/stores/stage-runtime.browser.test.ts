import en from '@proj-airi/i18n/locales/en'
import zh from '@proj-airi/i18n/locales/zh-Hans'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createApp, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import LocalVisionRuntime from '../../../../apps/stage-web/src/components/local-vision-runtime.vue'
import HeaderAvatar from '../../../stage-layouts/src/components/Layouts/HeaderAvatar.vue'
import Controls from '../components/scenarios/stage-runtime-controls.vue'

import { storage } from '../database/storage'
import { setupSynced } from '../libs/pinia'
import { useChatStore } from './chat'
import { useChatSessionStore } from './chat/session-store'
import { useCompanionStore } from './companion'
import { useLocalVisionStore } from './local-vision'
import { useRealtimeVoiceStore } from './modules/realtime-voice'
import { useSettingsAudioDevice } from './settings/audio-device'
import { useStageRuntimeStore } from './stage-runtime'

// Replace only the voice gateway IO; Vue, Pinia, browser capture and history stay real.
vi.mock('@proj-airi/realtime-voice/client', () => ({
  VoiceClient: class {
    async config() {
      return { configured: false }
    }

    close() {}
  },
}))

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  vi.restoreAllMocks()
  localStorage.clear()
})

async function fixture() {
  localStorage.clear()
  await storage.clear()
  await fetch('/api/local-vision/test-reset', { method: 'POST' })
  const originalFetch = window.fetch.bind(window)
  const calls: string[] = []
  let wake: () => Promise<Response> = async () => Response.json({ vision: 'ready' })
  const network = vi.spyOn(window, 'fetch').mockImplementation(async (input, options) => {
    const url = String(input)
    if (url.startsWith('/api/stage-runtime/')) {
      calls.push(url)
      return url.endsWith('/wake') ? wake() : Response.json({ vision: 'stopped' })
    }
    return originalFetch(input, options)
  })
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 240
  const streams: MediaStream[] = []
  const camera = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(async () => {
    const stream = canvas.captureStream(15)
    streams.push(stream)
    return stream
  })
  const painting = setInterval(() => canvas.getContext('2d')!.fillRect(0, 0, 320, 240), 50)
  const pinia = createPinia()
  const synced = setupSynced({ leadership: 'leader-only' })
  pinia.use(synced.pinia)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] })
  await router.push('/')
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ render: () => h('div', [h(HeaderAvatar), h(Controls), h(LocalVisionRuntime)]) })
  app.use(pinia).use(synced.vue).use(router).use(createI18n({ legacy: false, locale: 'zh-Hans', messages: { en, 'zh-Hans': zh } })).mount(container)
  const runtime = useStageRuntimeStore(pinia)
  const local = useLocalVisionStore(pinia)
  const voice = useRealtimeVoiceStore(pinia)
  const sessions = useChatSessionStore(pinia)
  cleanups.push(() => {
    app.unmount()
    disposePinia(pinia)
    clearInterval(painting)
    streams.forEach(stream => stream.getTracks().forEach(track => track.stop()))
    container.remove()
  })
  await vi.waitFor(() => expect(local.active).toBe(true), { timeout: 5000 })
  return { runtime, local, voice, sessions, container, camera, calls, network, streams, setWake: (next: () => Promise<Response>) => wake = next }
}

it('aIRI-037 closes capture, blocks all restarts and keeps guest settings and history available', async () => {
  const { runtime, local, voice, sessions, container, camera, streams } = await fixture()
  const sessionId = sessions.activeSessionId
  const history = [{ role: 'user' as const, content: 'Public regression fixture', id: 'sleep-retry-source' }]
  sessions.setSessionMessages(sessionId, history)
  await userEvent.click([...container.querySelectorAll('button')].find(button => button.textContent?.includes('关闭'))!)
  await vi.waitFor(() => expect(runtime.phase).toBe('sleeping'))
  expect(runtime.enabled).toBe(false)
  expect(local.mode).toBe('active')
  expect(local.active).toBe(false)
  expect(streams[0].getTracks()[0].readyState).toBe('ended')
  expect(localStorage.getItem('settings/stage/awake')).toBe('false')
  const count = camera.mock.calls.length
  await local.maintain()
  await local.start()
  expect(await voice.start()).toBe(false)
  expect(camera.mock.calls).toHaveLength(count)
  expect(voice.errorCode).toBe('sleeping')
  const chat = useChatStore()
  await expect(chat.send({ sessionId, text: 'Public regression fixture' })).rejects.toThrow(/启动/)
  await expect(chat.retry({ sessionId, index: 0 })).rejects.toThrow(/启动/)
  await expect(chat.rerunToolCall({ sessionId, toolName: 'web_search', toolCallId: 'sleep-tool', args: '{}' })).rejects.toThrow(/启动/)
  expect(sessions.getSessionMessages(sessionId)).toEqual(history)
  expect(sessions.activeSessionId).toBe(sessionId)
  expect(container.querySelector('a[aria-label="全部设置"]')?.getAttribute('href')).toBe('/settings')
  expect(container.textContent).toContain('陌生人')
})

it('aIRI-037 restarts after sleep without rewriting camera or microphone preferences', async () => {
  const { runtime, local, camera, container } = await fixture()
  const audio = useSettingsAudioDevice()
  const preference = audio.enabled
  await runtime.close()
  await userEvent.click([...container.querySelectorAll('button')].find(button => button.textContent?.includes('启动'))!)
  await vi.waitFor(() => expect(runtime.enabled).toBe(true))
  await vi.waitFor(() => expect(local.active).toBe(true), { timeout: 5000 })
  expect(camera.mock.calls).toHaveLength(2)
  expect(audio.enabled).toBe(preference)
  expect(local.permissions.face).toBe(true)
  expect(runtime.checks.find(check => check.name === 'voice')?.state).toBe('unconfigured')
  expect(container.textContent).toContain('未配置')
})

it('aIRI-037 closing during a pending wake fences the late response and duplicate starts', async () => {
  const { runtime, local, calls, setWake } = await fixture()
  await runtime.close()
  let finish!: (response: Response) => void
  setWake(() => new Promise<Response>((resolve) => {
    finish = resolve
  }))
  const starting = runtime.start()
  await vi.waitFor(() => expect(calls.filter(path => path.endsWith('/wake'))).toHaveLength(1))
  expect(await runtime.start()).toBe(false)
  await runtime.close()
  finish(Response.json({ vision: 'ready' }))
  expect(await starting).toBe(false)
  expect(runtime.phase).toBe('sleeping')
  expect(local.active).toBe(false)
  expect(calls.at(-1)).toBe('/api/stage-runtime/sleep')
})

it('aIRI-037 reports unavailable services while preserving text and settings access', async () => {
  const { runtime, setWake, container } = await fixture()
  await runtime.close()
  setWake(async () => Response.json({ vision: 'unavailable' }))
  expect(await runtime.start()).toBe(true)
  expect(runtime.checks.find(check => check.name === 'vision')?.state).toBe('unavailable')
  expect(runtime.checks.find(check => check.name === 'history')?.state).toBe('ready')
  expect(container.querySelector('a[aria-label="全部设置"]')).not.toBeNull()
})

it('aIRI-037 routes a follower close to one owner and publishes sleep to both windows', async () => {
  const namespace = `stage-runtime:${crypto.randomUUID()}`
  const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(Response.json({ vision: 'stopped' }))
  function renderer(leadership: 'leader-only' | 'follower-only') {
    const pinia = createPinia()
    const sync = createSyncedPiniaPlugin({ namespace, leadership, callTimeout: 3000 })
    pinia.use(sync.plugin)
    const container = document.createElement('div')
    document.body.append(container)
    const app = createApp({ setup() {
      useCompanionStore()
      return () => h(Controls)
    } })
    app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en } })).mount(container)
    const runtime = useStageRuntimeStore(pinia)
    cleanups.push(() => {
      sync.dispose()
      app.unmount()
      disposePinia(pinia)
      container.remove()
    })
    return { runtime, sync }
  }
  const leader = renderer('leader-only')
  await vi.waitFor(() => expect(leader.sync.isLeader()).toBe(true))
  const follower = renderer('follower-only')
  await vi.waitFor(() => expect(follower.sync.getLeaderId()).toBe(leader.sync.participantId))
  await follower.runtime.close()
  await vi.waitFor(() => expect(follower.runtime.phase).toBe('sleeping'))
  expect(leader.runtime.enabled).toBe(false)
  expect(follower.runtime.enabled).toBe(false)
  expect(fetch).toHaveBeenCalledOnce()
})

it('aIRI-037 keeps controls visible and explains refresh when the elected window lacks the new action', async () => {
  const namespace = `stage-runtime-old-window:${crypto.randomUUID()}`
  const old = createSyncedPiniaPlugin({ namespace, leadership: 'leader-only', callTimeout: 3000 })
  const leaderPinia = createPinia().use(old.plugin)
  const leaderApp = createApp({ render: () => h('div') }).use(leaderPinia)
  const leaderContainer = document.createElement('div')
  document.body.append(leaderContainer)
  leaderApp.mount(leaderContainer)
  await vi.waitFor(() => expect(old.isLeader()).toBe(true))
  const follower = createSyncedPiniaPlugin({ namespace, leadership: 'follower-only', callTimeout: 3000 })
  const pinia = createPinia().use(follower.plugin)
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ setup() {
    useCompanionStore()
    return () => h(Controls)
  } }).use(pinia).use(createI18n({ legacy: false, locale: 'zh-Hans', messages: { 'zh-Hans': zh } }))
  app.mount(container)
  cleanups.push(() => {
    follower.dispose()
    old.dispose()
    app.unmount()
    leaderApp.unmount()
    disposePinia(pinia)
    disposePinia(leaderPinia)
    container.remove()
    leaderContainer.remove()
  })
  await vi.waitFor(() => expect(follower.getLeaderId()).toBe(old.participantId))
  await userEvent.click([...container.querySelectorAll('button')].find(button => button.textContent?.includes('关闭'))!)
  await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('刷新所有 AIRI 页面'))
  expect(container.querySelectorAll('button')).toHaveLength(2)
  expect(useStageRuntimeStore(pinia).phase).toBe('running')
})
