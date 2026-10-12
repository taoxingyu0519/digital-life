<script setup lang="ts">
import { errorMessageFrom } from '@moeru/std'
import { Button, Callout, FieldCheckbox, FieldInput, FieldSelect } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useWebSearchStore } from '../../stores/modules/web-search'

const { t } = useI18n()
const webSearchStore = useWebSearchStore()
// Settings persist to localStorage on change (useLocalStorageManualReset), and
// the tool + prompt react to `configured` — so there is no explicit save step.
const { enabled, provider, apiKey, firecrawlApiKey, configured, lastSearch, lastFailure, credits } = storeToRefs(webSearchStore)
const testing = ref(false)
const testingCredits = ref(false)
const testError = ref('')
let configRevision = 0
watch([enabled, provider, apiKey, firecrawlApiKey], () => {
  configRevision++
  testError.value = ''
}, { flush: 'sync' })
const sources = computed(() => lastSearch.value?.results.filter(result => /^https?:\/\//.test(result.url) && URL.canParse(result.url)))
const errorHint = computed(() => {
  const status = lastFailure.value?.status
  if (status === 401 || status === 403)
    return t('settings.pages.modules.web-search.permission-error')
  if (status === 402)
    return t('settings.pages.modules.web-search.quota-error')
  if (status === 429)
    return t('settings.pages.modules.web-search.rate-error')
  if (status === 503)
    return t('settings.pages.modules.web-search.gateway-error')
  return ''
})

async function testSearch() {
  const revision = configRevision
  testing.value = true
  testError.value = ''
  try {
    await webSearchStore.testSearch()
  }
  catch (error) {
    if (revision === configRevision)
      testError.value = errorMessageFrom(error) ?? t('settings.pages.modules.web-search.test-failed')
  }
  finally {
    testing.value = false
  }
}

async function readCredits() {
  const revision = configRevision
  testingCredits.value = true
  testError.value = ''
  try {
    await webSearchStore.readCredits()
  }
  catch (error) {
    if (revision === configRevision)
      testError.value = errorMessageFrom(error) ?? t('settings.pages.modules.web-search.test-failed')
  }
  finally {
    testingCredits.value = false
  }
}
</script>

<template>
  <div
    :class="[
      'h-fit w-full',
      'flex flex-col gap-4',
      'rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]',
    ]"
  >
    <FieldCheckbox
      v-model="enabled"
      :label="t('settings.pages.modules.web-search.enable')"
      :description="t('settings.pages.modules.web-search.enable-description')"
    />

    <FieldSelect
      v-model="provider"
      :label="t('settings.pages.modules.web-search.provider')"
      :options="[
        { label: t('settings.pages.modules.web-search.firecrawl'), value: 'firecrawl' },
        { label: 'Tavily', value: 'tavily' },
      ]"
    />

    <Callout
      v-if="provider === 'firecrawl'"
      theme="primary"
      :label="t('settings.pages.modules.web-search.free-tier')"
    >
      {{ t('settings.pages.modules.web-search.free-tier-description') }}
    </Callout>

    <template v-if="provider === 'firecrawl'">
      <div :class="['flex flex-wrap gap-3 text-sm']">
        <a href="https://www.firecrawl.dev/signin" target="_blank" rel="noopener noreferrer" :class="['text-primary-500 underline']">
          {{ t('settings.pages.modules.web-search.register') }}
        </a>
        <a href="https://www.firecrawl.dev/app" target="_blank" rel="noopener noreferrer" :class="['text-primary-500 underline']">
          {{ t('settings.pages.modules.web-search.dashboard') }}
        </a>
      </div>
      <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.modules.web-search.registration-guide') }}
      </p>
      <FieldInput
        v-model="firecrawlApiKey"
        type="password"
        :label="t('settings.pages.modules.web-search.firecrawl-key')"
        :description="t('settings.pages.modules.web-search.firecrawl-key-description')"
        placeholder="fc-..."
      />
      <Button :disabled="!firecrawlApiKey.trim() || testingCredits" :loading="testingCredits" @click="readCredits">
        {{ t('settings.pages.modules.web-search.check-credits') }}
      </Button>
      <p v-if="credits" aria-live="polite">
        {{ t('settings.pages.modules.web-search.remaining-credits', { remaining: credits.remainingCredits, plan: credits.planCredits }) }}
      </p>
    </template>

    <FieldInput
      v-if="provider === 'tavily'"
      v-model="apiKey"
      type="password"
      :label="t('settings.pages.modules.web-search.api-key')"
      :description="t('settings.pages.modules.web-search.api-key-description')"
      :placeholder="t('settings.pages.modules.web-search.api-key-placeholder')"
    />

    <Callout
      v-if="configured"
      theme="lime"
      :label="t('settings.pages.modules.web-search.configured')"
    />

    <Button :disabled="!configured || testing" :loading="testing" @click="testSearch">
      {{ t('settings.pages.modules.web-search.test') }}
    </Button>
    <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ t('settings.pages.modules.web-search.test-description') }}
    </p>
    <Callout v-if="testError || lastFailure" theme="orange" :label="t('settings.pages.modules.web-search.test-failed')">
      <p>{{ testError || lastFailure?.message }}</p>
      <p v-if="errorHint">
        {{ errorHint }}
      </p>
      <p v-if="lastFailure">
        {{ t('settings.pages.modules.web-search.retry-paused') }}
      </p>
    </Callout>
    <div v-if="lastSearch" :class="['flex flex-col gap-2 text-sm']" aria-live="polite">
      <p>{{ t('settings.pages.modules.web-search.last-search', { provider: lastSearch.provider, count: lastSearch.results.length }) }}</p>
      <p v-if="lastSearch.creditsUsed != null">
        {{ t('settings.pages.modules.web-search.credits-used', { credits: lastSearch.creditsUsed }) }}
      </p>
      <p v-if="lastSearch.requestId" :class="['break-all text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.modules.web-search.request-id', { id: lastSearch.requestId }) }}
      </p>
      <a v-for="source in sources" :key="source.url" :href="source.url" target="_blank" rel="noopener noreferrer" :class="['break-all text-primary-500 underline']">
        {{ source.title || source.url }}
      </a>
    </div>
  </div>
</template>
