import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import WebSearch from '../../components/modules/WebSearch.vue'

import { useLlmToolsetPromptsStore } from '../ai/chat-llm/toolset-prompts'
import { useWebSearchStore } from './web-search'

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  vi.restoreAllMocks()
  localStorage.clear()
})

function fixture() {
  localStorage.clear()
  const pinia = createPinia()
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ render: () => h(WebSearch) })
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en } })).mount(container)
  cleanups.push(() => {
    app.unmount()
    disposePinia(pinia)
    container.remove()
  })
  return { container, search: useWebSearchStore(pinia), prompts: useLlmToolsetPromptsStore(pinia) }
}

it('gates search permission and prompt together while keeping Tavily credentials separate', async () => {
  const { search, prompts } = fixture()
  expect(search.provider).toBe('firecrawl')
  expect(search.configured).toBe(false)
  search.enabled = true
  await nextTick()
  expect(search.configured).toBe(true)
  expect(prompts.activeToolsetPrompt).toContain('web_search')
  search.provider = 'tavily'
  await nextTick()
  expect(search.configured).toBe(false)
  expect(prompts.activeToolsetPrompt).toBe('')
  search.apiKey = ' test-key '
  await nextTick()
  expect(search.configured).toBe(true)
  search.enabled = false
  await nextTick()
  expect(prompts.activeToolsetPrompt).toBe('')
})

it('shows source links and consumed credits only after an actual test request succeeds', async () => {
  const { search, container } = fixture()
  search.enabled = true
  await nextTick()
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, id: 'test-receipt', creditsUsed: 2, data: { web: [{ title: 'Official pricing', url: 'https://www.firecrawl.dev/pricing', description: 'Free plan.' }] } })))
  const button = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Test search'))
  expect(button).toBeDefined()
  button!.click()
  await vi.waitFor(() => expect(search.lastSearch?.requestId).toBe('test-receipt'))
  await nextTick()
  expect(container.textContent).toContain('Credits reported by service: 2')
  expect(container.querySelector('a[href="https://www.firecrawl.dev/pricing"]')).not.toBeNull()
  expect(localStorage.getItem('settings/web-search/last-search')).toBeNull()
})

it('displays quota failure without creating a successful receipt', async () => {
  const { search, container } = fixture()
  search.enabled = true
  await nextTick()
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 429 }))
  const button = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Test search'))
  button!.click()
  await vi.waitFor(() => expect(container.textContent).toContain('firecrawl 429'))
  expect(search.lastSearch).toBeUndefined()
})

it('provides official registration and a separate account key, and reads real credit fields', async () => {
  const { search, container } = fixture()
  expect(container.querySelector('a[href="https://www.firecrawl.dev/signin"]')).not.toBeNull()
  expect(container.querySelector('a[href="https://www.firecrawl.dev/app"]')).not.toBeNull()
  search.enabled = true
  search.apiKey = 'tvly-separate-key'
  search.firecrawlApiKey = ' fc-test-account '
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, data: { remainingCredits: 876, planCredits: 1000 } })))
  await search.readCredits()
  expect(fetch.mock.calls[0][0]).toBe('/api/web-search/firecrawl/credits')
  expect(new Headers(fetch.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer fc-test-account')
  expect(search.apiKey).toBe('tvly-separate-key')
  await nextTick()
  expect(container.textContent).toContain('Service balance: 876')
})

it('blocks later model attempts after an actual 403 until a manual test or key change', async () => {
  const { search, container } = fixture()
  search.enabled = true
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'Permission denied' }), { status: 403 }))
  const [first] = await search.createTools()
  await expect(first.execute({ query: 'current news' }, { messages: [], toolCallId: 'first' })).rejects.toThrow('Permission denied')
  const [second] = await search.createTools()
  await expect(second.execute({ query: 'different query' }, { messages: [], toolCallId: 'second' })).rejects.toThrow('firecrawl 403')
  expect(fetch).toHaveBeenCalledTimes(1)
  await nextTick()
  expect(container.textContent).toContain('Search retries are paused')
  search.firecrawlApiKey = 'fc-new-test-account'
  fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { web: [] } })))
  expect(search.lastFailure).toBeUndefined()
  const [fixed] = await search.createTools()
  await fixed.execute({ query: 'current news' }, { messages: [], toolCallId: 'fixed' })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('discards a late test failure after credentials change and preserves credit-service denial details', async () => {
  const { search, container } = fixture()
  search.enabled = true
  let finish: (value: Response) => void = () => {
    throw new Error('Request has not started')
  }
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise<Response>((resolve) => {
    finish = resolve
  }))
  await nextTick()
  const button = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Test search'))!
  button.click()
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  search.firecrawlApiKey = 'fc-new-account'
  finish(new Response(JSON.stringify({ error: 'Old account denied' }), { status: 403 }))
  await vi.waitFor(() => expect(button.disabled).toBe(false))
  expect(search.lastFailure).toBeUndefined()
  expect(container.textContent).not.toContain('Old account denied')
  fetch.mockImplementation(async () => new Response(JSON.stringify({ code: 'ACCOUNT_ACCESS_DENIED', error: 'Check fc-new-account permissions' }), { status: 403 }))
  await expect(search.readCredits()).rejects.toThrow('ACCOUNT_ACCESS_DENIED')
  await expect(search.readCredits()).rejects.not.toThrow('fc-new-account')
})
