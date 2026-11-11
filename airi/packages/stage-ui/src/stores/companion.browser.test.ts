import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import LocalVisionRuntime from '../../../../apps/stage-web/src/components/local-vision-runtime.vue'

import { useFaceGaze } from '../composables/vision/use-face-gaze'
import { storage } from '../database/storage'
import { setupSynced } from '../libs/pinia'
import { useChatSessionStore } from './chat/session-store'
import { useCompanionStore } from './companion'
import { useLocalVisionStore } from './local-vision'
import { useSpeechRuntimeStore } from './speech-runtime'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0))
    cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

// http://127.0.0.1:5174 — AIRI-011, active mode fails to greet a visible visitor.
// ROOT CAUSE:
// Text greetings required an audio host. A watcher returned a new array for every snapshot and cancelled each pending greeting.
// Compare individual encounter values and keep text output independent of the speech host.
it('aIRI-011 keeps seeing and greets once during continuous frames without a speech host', async () => {
  localStorage.clear()
  await storage.clear()
  await fetch('/api/local-vision/test-reset', { method: 'POST' })
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 240
  const context = canvas.getContext('2d')!
  const media = canvas.captureStream(15)
  const painting = setInterval(() => {
    context.fillStyle = `rgb(${Math.floor(performance.now()) % 255}, 100, 100)`
    context.fillRect(0, 0, canvas.width, canvas.height)
  }, 50)
  const streams = [media]
  vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(async () => {
    if (streams.length === 1 && media.active)
      return media
    const next = canvas.captureStream(15)
    streams.push(next)
    return next
  })
  const pinia = createPinia()
  const synced = setupSynced({ leadership: 'leader-only' })
  pinia.use(synced.pinia)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push('/')
  let gaze!: ReturnType<typeof useFaceGaze>
  const app = createApp({
    setup() {
      gaze = useFaceGaze()
      return () => h(LocalVisionRuntime)
    },
  })
  const container = document.createElement('div')
  document.body.append(container)
  app.use(pinia).use(synced.vue).use(router).use(createI18n({ legacy: false, locale: 'en', messages: { en } })).mount(container)
  const local = useLocalVisionStore(pinia)
  const companion = useCompanionStore(pinia)
  const sessions = useChatSessionStore(pinia)
  const speech = useSpeechRuntimeStore(pinia)
  cleanups.push(() => {
    clearInterval(painting)
    local.stop()
    app.unmount()
    disposePinia(pinia)
    container.remove()
    streams.forEach(stream => stream.getTracks().forEach(track => track.stop()))
  })
  expect(speech.isHost()).toBe(false)
  expect(companion.modelReady).toBe(false)
  await vi.waitFor(() => expect(local.result?.snapshot.seq).toBeGreaterThan(3), { timeout: 6000 })
  await vi.waitFor(() => expect(gaze.value?.x).toBeCloseTo(0.6, 1))
  expect(gaze.value?.y).toBeCloseTo(0.2, 1)
  await vi.waitFor(() => expect(local.greeting?.text).toContain('What is your name?'), { timeout: 4000 })
  expect(sessions.messages.filter(message => message.localVisionDerived)).toHaveLength(1)
  expect(container.textContent).toContain('Frames processed')
  expect(container.textContent).toContain('stored profile match is too weak')
  expect(local.captureFps).toBeGreaterThan(0)
  expect(local.captureFps).toBeLessThanOrEqual(1.05)
  const before = local.result!.snapshot.seq
  const scope = local.projectScope(sessions.activeSessionId)
  await vi.waitFor(() => expect(local.result!.snapshot.seq).toBeGreaterThan(before + 2), { timeout: 4000 })
  expect(local.projectScope(sessions.activeSessionId)).toBe(scope)
  expect(gaze.value).toBeDefined()
  local.permissions.observations = false
  expect(local.projectScope(sessions.activeSessionId)).not.toBe(scope)
  await vi.waitFor(() => expect(gaze.value).toBeUndefined())
  local.permissions.observations = true
  await vi.waitFor(() => expect(gaze.value).toBeDefined())
  expect(sessions.messages.filter(message => message.localVisionDerived)).toHaveLength(1)
  local.setMode('passive')
  expect(media.getTracks().every(track => track.readyState === 'ended')).toBe(true)
  expect(local.result).toBeUndefined()
  expect(local.status).toBe('off')
  await vi.waitFor(() => expect(gaze.value).toBeUndefined())
  local.setMode('active')
  await vi.waitFor(() => expect(local.isFresh()).toBe(true))
  await local.hear('My name is Alex', sessions.activeSessionId)
  await vi.waitFor(() => expect(local.profile?.display_name).toBe('Alex'))
  await vi.waitFor(() => expect(container.textContent).toContain('Current face identity confirmed'), { timeout: 2500 })
  expect(local.project(sessions.activeSessionId)).toContain('locally confirmed as "Alex"')
  local.setMode('passive')
  local.setMode('active')
  await vi.waitFor(() => expect(local.profile?.display_name).toBe('Alex'))
  expect(local.project(sessions.activeSessionId)).toContain('locally confirmed as "Alex"')
  expect(local.project(sessions.activeSessionId)).toContain('My name is Alex')
}, 25000)
