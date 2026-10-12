import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import MemoryManager from './memory-manager.vue'

import { useDeveloperAccessStore } from '../../stores/developer-access'

afterEach(() => {
  vi.restoreAllMocks()
})

it('aIRI-029 revokes a selected face collection round through the protected API and keeps memories', async () => {
  let revoked = false
  const fetch = vi.spyOn(window, 'fetch').mockImplementation(async (url, init) => {
    const path = String(url)
    if (path.endsWith('/admin/overview')) {
      return Response.json({ counts: { people: 1 }, characters: ['default'], persons: [{ person_id: 'generated', display_name: 'Generated Person' }], rules: [] })
    }
    if (init?.method === 'DELETE') {
      expect(path).toBe('/api/local-vision/admin/persons/generated/face-extensions/generated-round')
      revoked = true
      return Response.json({ deleted: true })
    }
    return Response.json({
      memories: [{ event_id: 'generated-event', text: 'Generated conversation memory', at: 1 }],
      face_extensions: revoked ? [] : [{ round_id: 'generated-round', count: 2, at: 1 }],
    })
  })
  const pinia = createPinia()
  useDeveloperAccessStore(pinia).authenticated = true
  const screen = render(MemoryManager, {
    props: { mode: 'memory' },
    global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })] },
  })
  await screen.getByRole('combobox').click()
  await screen.getByRole('option', { name: 'Generated Person', exact: true }).click()
  await screen.getByRole('button', { name: 'Revoke this collection round', exact: true }).click()
  expect(fetch.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false)
  await screen.getByRole('button', { name: 'Confirm revoking this collection round', exact: true }).click()
  await expect.element(screen.getByText('No reviewed face samples yet.', { exact: true })).toBeVisible()
  await expect.element(screen.getByRole('textbox', { name: 'Conversation memory text' })).toHaveValue('Generated conversation memory')
  screen.unmount()
  disposePinia(pinia)
})

it('aIRI-025 selects a generated profile and reads its character-scoped memories through the real selector', async () => {
  const fetch = vi.spyOn(window, 'fetch').mockImplementation(async (url) => {
    if (String(url).endsWith('/admin/overview')) {
      return Response.json({
        counts: { people: 1 },
        characters: ['default'],
        persons: [{ person_id: 'generated', display_name: 'Generated Person' }],
        rules: [{ id: 'name-confirmation', text: 'Confirm the written name before saving.', updated_at: 1 }],
      })
    }
    return Response.json({ memories: [{ event_id: 'generated-event', text: 'Generated conversation memory', at: 1 }], face_extensions: [] })
  })
  const pinia = createPinia()
  const access = useDeveloperAccessStore(pinia)
  access.authenticated = true
  const screen = render(MemoryManager, {
    props: { mode: 'memory' },
    global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })] },
  })
  await screen.getByRole('combobox').click()
  await screen.getByRole('option', { name: 'Generated Person', exact: true }).click()
  await expect.element(screen.getByRole('textbox', { name: 'Conversation memory text' })).toHaveValue('Generated conversation memory')
  expect(fetch.mock.calls.some(call => String(call[0]) === '/api/local-vision/admin/persons/generated?character=default')).toBe(true)
  screen.unmount()
  disposePinia(pinia)
})
