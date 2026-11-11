import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

import ReadingControls from './reading-controls.vue'

import { useSettingsChatReading } from '../../../../stores/settings/chat-reading'

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  localStorage.clear()
})

function fixture() {
  const pinia = createPinia()
  const screen = render(ReadingControls, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })] } })
  const close = () => {
    screen.unmount()
    disposePinia(pinia)
  }
  return { close, reading: useSettingsChatReading(pinia) }
}

// http://127.0.0.1:5174 — AIRI-046: reading controls must remain usable after the stage reloads.
it('aIRI-046 adjusts reading sizes, restores them in a new app instance and resets both', async () => {
  localStorage.clear()
  const first = fixture()
  await userEvent.click(page.getByRole('button', { name: 'Text and bubble size', exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'Increase text size', exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'Increase text size', exact: true }))
  await userEvent.click(page.getByRole('button', { name: 'Larger bubbles', exact: true }))
  expect(first.reading.fontSize).toBe(22)
  expect(first.reading.bubbleSize).toBe(3)
  first.close()
  const second = fixture()
  cleanups.push(second.close)
  await userEvent.click(page.getByRole('button', { name: 'Text and bubble size', exact: true }))
  await expect.element(page.getByText('22px', { exact: true })).toBeVisible()
  expect(second.reading.bubbleSize).toBe(3)
  await userEvent.click(page.getByRole('button', { name: 'Restore defaults', exact: true }))
  await expect.element(page.getByText('18px', { exact: true })).toBeVisible()
  expect(second.reading.bubbleSize).toBe(2)
})
