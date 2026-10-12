import type { WebSearchProvider, WebSearchReceipt } from '../../tools/web-search'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'

import * as v from 'valibot'

import { createWebSearchTools, WEB_SEARCH_TOOLSET_PROMPT } from '../../tools/web-search'
import { FIRECRAWL_CREDITS_PATH, firecrawlCreditsSchema, FirecrawlError, readFirecrawlError } from '../../tools/web-search-contract'
import { useLlmToolsetPromptsStore } from '../ai/chat-llm/toolset-prompts'

/**
 * Persists search selection and records successful responses only in memory.
 *
 * Renderer-only: unlike the messaging modules it does not broadcast to a backend
 * service, so there is no configurator channel here. The tool itself is mounted
 * by `resolveWebSearchTools` in `stores/ai/chat-llm/tool-resolver.ts`, gated on
 * {@link configured}; this store owns the paired system-prompt guidance so the
 * "web content is data, not instructions" rule is present exactly when the tool
 * is, and gone when it is not.
 */
export const useWebSearchStore = defineStore('web-search', () => {
  const toolsetPromptsStore = useLlmToolsetPromptsStore()

  const enabled = useLocalStorageManualReset<boolean>('settings/web-search/enabled', false)
  const provider = useLocalStorageManualReset<WebSearchProvider>('settings/web-search/provider', 'firecrawl')
  const apiKey = useLocalStorageManualReset<string>('settings/web-search/api-key', '')
  const firecrawlApiKey = useLocalStorageManualReset<string>('settings/web-search/firecrawl-api-key', '')
  const lastSearch = ref<WebSearchReceipt>()
  const lastFailure = shallowRef<FirecrawlError>()
  const credits = ref<v.InferOutput<typeof firecrawlCreditsSchema>['data']>()
  let revision = 0

  const configured = computed(() => enabled.value && (provider.value === 'firecrawl' || (provider.value === 'tavily' && apiKey.value.trim().length > 0)))

  function recordSearch(receipt: WebSearchReceipt) {
    lastSearch.value = receipt
  }

  // Failures and receipts belong to one credential selection. An old response
  // cannot block or certify a newly configured service.
  watch([enabled, provider, apiKey, firecrawlApiKey], () => {
    revision++
    lastSearch.value = undefined
    lastFailure.value = undefined
    credits.value = undefined
  }, { flush: 'sync' })

  async function createTools() {
    const currentRevision = revision
    return createWebSearchTools({
      provider: provider.value,
      apiKey: provider.value === 'firecrawl' ? firecrawlApiKey.value.trim() : apiKey.value.trim(),
      onResult: (receipt) => {
        if (currentRevision === revision)
          recordSearch(receipt)
      },
      onFailure: (error) => {
        if (currentRevision === revision)
          lastFailure.value = error
      },
      blockedError: () => currentRevision === revision ? lastFailure.value : new FirecrawlError(409, 'Search configuration changed. Start a new task.'),
    })
  }

  async function readCredits() {
    const currentRevision = revision
    const key = firecrawlApiKey.value.trim()
    if (!key)
      throw new FirecrawlError(401, 'A Firecrawl account key is required to read credits.')
    const response = await fetch(FIRECRAWL_CREDITS_PATH, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(25_000) })
    if (!response.ok)
      throw await readFirecrawlError(response, key)
    const payload = v.parse(firecrawlCreditsSchema, await response.json())
    if (!payload.success)
      throw new Error('Firecrawl did not return account credits')
    if (currentRevision === revision)
      credits.value = payload.data
  }

  async function testSearch() {
    if (!configured.value)
      throw new Error('Web search is not enabled or configured')
    lastFailure.value = undefined
    const [tool] = await createTools()
    await tool.execute({ query: 'site:firecrawl.dev/pricing Firecrawl free monthly credits', max_results: 3 }, { messages: [], toolCallId: 'settings-search-check' })
  }

  // Keep the safety/when-to-search guidance mounted iff the tool is mounted.
  // Clauses must key off the same `configured` gate the tool does, never a raw
  // key read, so the model is never told about a tool it cannot call.
  watch(configured, (isConfigured) => {
    if (isConfigured)
      toolsetPromptsStore.registerToolsetPrompts('web-search', [{ id: 'web-search', content: WEB_SEARCH_TOOLSET_PROMPT }])
    else
      toolsetPromptsStore.clearToolsetPrompts('web-search')
  }, { immediate: true })

  function resetState() {
    enabled.reset()
    provider.reset()
    apiKey.reset()
    firecrawlApiKey.reset()
    lastSearch.value = undefined
    lastFailure.value = undefined
    credits.value = undefined
  }

  return {
    enabled,
    provider,
    apiKey,
    firecrawlApiKey,
    configured,
    lastSearch,
    lastFailure,
    credits,
    recordSearch,
    createTools,
    readCredits,
    testSearch,
    resetState,
  }
})
