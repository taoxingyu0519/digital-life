import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import { useLocalVisionStore } from './local-vision'

const cleanups: Array<() => void> = []

function renderer() {
  const pinia = createPinia()
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({
    setup() {
      useLocalVisionStore()
      return () => null
    },
  })
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en } })).mount(container)
  const local = useLocalVisionStore(pinia)
  cleanups.push(() => {
    app.unmount()
    disposePinia(pinia)
    container.remove()
  })
  return local
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0))
    cleanup()
  vi.restoreAllMocks()
  localStorage.removeItem('settings/local-vision/mode')
  localStorage.removeItem('settings/local-vision/permissions')
})

it('aIRI-011 defaults to active local perception and persists passive mode across renderers', async () => {
  localStorage.removeItem('settings/local-vision/mode')
  const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(Response.json({ error: 'service-unavailable' }, { status: 503 }))
  const first = renderer()
  expect(first.mode).toBe('active')
  expect(first.permissions.face).toBe(true)
  expect(first.permissions.greetings).toBe(true)
  expect(first.permissions.images).toBe(false)
  first.setMode('passive')
  const second = renderer()
  expect(second.mode).toBe('passive')
  second.owner = true
  await second.maintain()
  expect(fetch).not.toHaveBeenCalled()
  first.setMode('active')
  await vi.waitFor(() => expect(second.mode).toBe('active'))
})

it('aIRI-011 passive mode fences an in-flight automatic start before camera access', async () => {
  localStorage.removeItem('settings/local-vision/mode')
  let resolve!: (response: Response) => void
  const fetch = vi.spyOn(window, 'fetch').mockImplementation(() => new Promise<Response>((done) => {
    resolve = done
  }))
  const media = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
  const local = renderer()
  local.owner = true
  const starting = local.maintain()
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  local.setMode('passive')
  resolve(Response.json({ protocol: '1.0', ready: false, error: 'loading', device: 'unavailable', calibrated: false, camera_condition: null, grounding: 'missing' }))
  await starting
  expect(media).not.toHaveBeenCalled()
  expect(local.status).toBe('off')
  expect(local.source).toBeUndefined()
})
