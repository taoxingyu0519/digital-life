import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import DeveloperGate from './developer-gate.vue'

import { useDeveloperAccessStore } from '../../stores/developer-access'

afterEach(() => {
  vi.restoreAllMocks()
})

it('aIRI-025 hides maintenance content until the server grants a session and clears it on logout', async () => {
  let authenticated = false
  const fetch = vi.spyOn(window, 'fetch').mockImplementation(async (_url, options) => {
    if (options?.method === 'POST')
      authenticated = true
    if (options?.method === 'DELETE')
      authenticated = false
    return Response.json({ authenticated, expires_at: authenticated ? Date.now() / 1000 + 3600 : 0 })
  })
  const pinia = createPinia()
  const screen = render(DeveloperGate, {
    slots: { default: '<div>Private maintenance records</div>' },
    global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })] },
  })
  const access = useDeveloperAccessStore(pinia)
  await vi.waitFor(() => expect(access.ready).toBe(true))
  expect(document.body.textContent).not.toContain('Private maintenance records')
  await access.login('test-developer', 'generated-test-password')
  await vi.waitFor(() => expect(document.body.textContent).toContain('Private maintenance records'))
  expect(fetch.mock.calls.find(call => call[1]?.method === 'POST')?.[1]?.credentials).toBe('same-origin')
  await access.logout()
  await vi.waitFor(() => expect(document.body.textContent).not.toContain('Private maintenance records'))
  expect(localStorage.getItem('developer-access')).toBeNull()
  screen.unmount()
  disposePinia(pinia)
})

it('aIRI-025 denies a forged local flag after the server rejects an admin request', async () => {
  vi.spyOn(window, 'fetch').mockResolvedValue(Response.json({ error: 'developer-required' }, { status: 403 }))
  const pinia = createPinia()
  const access = useDeveloperAccessStore(pinia)
  access.authenticated = true
  await expect(access.request('/admin/overview')).rejects.toThrow('developer-403')
  expect(access.authenticated).toBe(false)
  disposePinia(pinia)
})
